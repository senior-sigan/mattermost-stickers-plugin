package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/plugin"
	"golang.org/x/image/draw"
)

const maxStickerBytes = 512 * 1024
const maxStickerDimension = 192

type Sticker struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Pack string `json:"pack"`
	Data []byte `json:"data,omitempty"`
}

type Plugin struct {
	plugin.MattermostPlugin
	bundled        map[string]Sticker
	catalogMu      sync.Mutex
	cachedCatalog  []Sticker
	catalogExpires time.Time
}

func main() { plugin.ClientMain(&Plugin{}) }

func validate(data []byte) error {
	_, err := decodePNG(data)
	return err
}

func decodePNG(data []byte) (image.Image, error) {
	if len(data) > maxStickerBytes {
		return nil, fmt.Errorf("PNG must be at most 512 KiB")
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("invalid or unsupported PNG: %w", err)
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 2048 || config.Height > 2048 {
		return nil, fmt.Errorf("PNG dimensions must be between 1 and 2048 pixels")
	}
	decoded, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("invalid PNG image: %w", err)
	}
	return decoded, nil
}

func normalizePNG(data []byte) ([]byte, error) {
	source, err := decodePNG(data)
	if err != nil {
		return nil, err
	}
	w, h := source.Bounds().Dx(), source.Bounds().Dy()
	if w <= maxStickerDimension && h <= maxStickerDimension {
		// Preserve already optimized palette PNGs byte-for-byte.
		return data, nil
	}
	if w >= h {
		h = max(1, h*maxStickerDimension/w)
		w = maxStickerDimension
	} else {
		w = max(1, w*maxStickerDimension/h)
		h = maxStickerDimension
	}
	destination := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(destination, destination.Bounds(), source, source.Bounds(), draw.Src, nil)
	var output bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(&output, destination); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func stickerID(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func (p *Plugin) OnActivate() error {
	bundle, err := p.API.GetBundlePath()
	if err != nil {
		return err
	}
	p.bundled = map[string]Sticker{}
	root := filepath.Join(bundle, "assets", "stickers")
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(path), ".png") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := validate(data); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		id := stickerID(data)
		p.bundled[id] = Sticker{ID: id, Name: strings.TrimSuffix(entry.Name(), filepath.Ext(path)), Pack: filepath.Base(filepath.Dir(path)), Data: data}
		return nil
	})
	if err != nil {
		return err
	}
	_, err = p.catalog()
	return err
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"message": message})
}

func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("Mattermost-User-ID") == "" {
		fail(w, 401, "Authentication required")
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/stickers" {
		items, err := p.catalog()
		if err != nil {
			p.API.LogError("Failed to load stickers", "error", err.Error())
			fail(w, 500, "Failed to load stickers")
			return
		}
		respond(w, 200, items)
		return
	}
	if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/image/") {
		id := strings.TrimPrefix(r.URL.Path, "/image/")
		decoded, err := hex.DecodeString(id)
		if err != nil || len(decoded) != 32 {
			fail(w, 404, "Sticker not found")
			return
		}
		sticker, found := p.bundled[id]
		if !found {
			data, err := p.API.KVGet(imagePrefix + id)
			if err != nil {
				fail(w, 500, "Failed to load sticker")
				return
			}
			if len(data) == 0 {
				fail(w, 404, "Sticker not found")
				return
			}
			sticker.Data = data
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		_, _ = w.Write(sticker.Data)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/stickers" {
		// Resolve the authenticated user on every mutation; never trust browser
		// roles or a previous session's permissions (including after demotion).
		user, authErr := p.API.GetUser(r.Header.Get("Mattermost-User-ID"))
		if authErr != nil || user == nil || !user.IsSystemAdmin() {
			fail(w, 403, "Only system administrators can upload stickers")
			return
		}
		// A custom header prevents cross-origin HTML forms from mutating the catalog.
		if r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
			fail(w, 403, "Missing request header")
			return
		}
		if r.Header.Get("Content-Type") != "image/png" {
			fail(w, 415, "Only PNG stickers are supported")
			return
		}
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxStickerBytes))
		if err != nil {
			fail(w, 413, "PNG must be at most 512 KiB")
			return
		}
		data, err = normalizePNG(data)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		name, err := url.QueryUnescape(r.Header.Get("X-Sticker-Name"))
		if err != nil || len(name) > 200 {
			fail(w, 400, "Invalid sticker name")
			return
		}
		if !strings.EqualFold(filepath.Ext(name), ".png") {
			fail(w, 400, "Only .png files are supported")
			return
		}
		name = strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
		if name == "" || name == "." {
			name = "Sticker"
		}
		sticker := Sticker{ID: stickerID(data), Name: name, Pack: "Uploaded", Data: data}
		if bundled, exists := p.bundled[sticker.ID]; exists {
			bundled.Data = nil
			respond(w, 200, bundled)
			return
		}
		if err := p.saveSticker(sticker); err != nil {
			p.API.LogError("Failed to save sticker", "error", err.Error())
			fail(w, 500, "Failed to save sticker")
			return
		}
		sticker.Data = nil
		respond(w, 201, sticker)
		return
	}
	fail(w, 404, "Not found")
}
