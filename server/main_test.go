package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

type fakeAPI struct {
	plugin.API
	values map[string][]byte
	bundle string
	roles  string
}

func (a *fakeAPI) GetUser(id string) (*model.User, *model.AppError) {
	return &model.User{Id: id, Roles: a.roles}, nil
}

func (a *fakeAPI) GetBundlePath() (string, error)           { return a.bundle, nil }
func (a *fakeAPI) KVGet(k string) ([]byte, *model.AppError) { return a.values[k], nil }
func (a *fakeAPI) KVSet(k string, v []byte) *model.AppError { a.values[k] = v; return nil }
func (a *fakeAPI) KVList(page, size int) ([]string, *model.AppError) {
	keys := []string{}
	for k := range a.values {
		keys = append(keys, k)
	}
	if page*size >= len(keys) {
		return []string{}, nil
	}
	end := (page + 1) * size
	if end > len(keys) {
		end = len(keys)
	}
	return keys[page*size : end], nil
}

func TestBundledPNG(t *testing.T) {
	files, err := filepath.Glob("../stickers/*/*.png")
	if err != nil || len(files) == 0 {
		t.Fatal("missing example stickers", err)
	}
	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := validate(data); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		decoded, _ := png.Decode(bytes.NewReader(data))
		if decoded.Bounds().Dx() > 192 || decoded.Bounds().Dy() > 192 {
			t.Fatalf("oversized bundled sticker: %s", path)
		}
		if _, ok := decoded.(*image.Paletted); !ok {
			t.Fatalf("not a quantized palette PNG: %s", path)
		}
	}
	if validate([]byte("not png")) == nil {
		t.Fatal("accepted invalid PNG")
	}
	if validate(make([]byte, maxStickerBytes+1)) == nil {
		t.Fatal("accepted oversized data")
	}
}

func TestHTTPUploadAndRead(t *testing.T) {
	data, err := os.ReadFile("../stickers/cumemoji_stickers/001.png")
	if err != nil {
		t.Fatal(err)
	}
	p := &Plugin{bundled: map[string]Sticker{}}
	p.SetAPI(&fakeAPI{values: map[string][]byte{}, roles: "system_user system_admin"})
	request := func(method, path string, body []byte, auth, csrf bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		if auth {
			r.Header.Set("Mattermost-User-ID", "user")
		}
		if csrf {
			r.Header.Set("X-Requested-With", "XMLHttpRequest")
		}
		r.Header.Set("X-Sticker-Name", "example.png")
		r.Header.Set("Content-Type", "image/png")
		w := httptest.NewRecorder()
		p.ServeHTTP(nil, w, r)
		return w
	}
	if w := request("GET", "/stickers", nil, false, false); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/stickers", data, true, false); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/stickers", []byte("fake"), true, true); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/stickers", make([]byte, maxStickerBytes+1), true, true); w.Code != 413 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/stickers", data, true, true); w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	w := request("GET", "/stickers", nil, true, false)
	var items []Sticker
	if err := json.Unmarshal(w.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Data != nil {
		t.Fatal("catalog should contain only metadata")
	}
	w = request("GET", "/image/"+items[0].ID, nil, true, false)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatal("image changed")
	}
	if w.Header().Get("Content-Type") != "image/png" {
		t.Fatal("wrong MIME type")
	}
	if w = request("GET", "/image/../../etc/passwd", nil, true, false); w.Code != 404 {
		t.Fatal(w.Code)
	}
	// Repeated identical uploads occupy one key, surviving new plugin instances.
	request("POST", "/stickers", data, true, true)
	restarted := &Plugin{bundled: map[string]Sticker{}}
	restarted.SetAPI(p.API)
	items, err = restarted.catalog()
	if err != nil || len(items) != 1 {
		t.Fatal(items, err)
	}
}

func TestLegacyWebPExcluded(t *testing.T) {
	p := &Plugin{bundled: map[string]Sticker{}}
	api := &fakeAPI{values: map[string][]byte{"sticker_legacy": []byte(`{"id":"legacy","data":"UkVGRg=="}`)}}
	p.SetAPI(api)
	items, err := p.catalog()
	if err != nil || len(items) != 0 {
		t.Fatal("legacy WebP included in PNG catalog", err)
	}
	if len(api.values) != 1 {
		t.Fatal("legacy records must not be deleted")
	}
}

func TestUploadsRequireSystemAdmin(t *testing.T) {
	data, err := os.ReadFile("../stickers/cumemoji_stickers/001.png")
	if err != nil {
		t.Fatal(err)
	}
	for _, roles := range []string{"system_user", "system_guest", "system_user team_admin", "", "system_user system_admin"} {
		t.Run(roles, func(t *testing.T) {
			api := &fakeAPI{values: map[string][]byte{}, roles: roles}
			p := &Plugin{bundled: map[string]Sticker{}}
			p.SetAPI(api)
			upload := func() int {
				r := httptest.NewRequest("POST", "/stickers", bytes.NewReader(data))
				r.Header.Set("Mattermost-User-ID", "user")
				r.Header.Set("X-Requested-With", "XMLHttpRequest")
				r.Header.Set("Content-Type", "image/png")
				r.Header.Set("X-Sticker-Name", "001.png")
				w := httptest.NewRecorder()
				p.ServeHTTP(nil, w, r)
				return w.Code
			}
			if roles == "system_user system_admin" {
				if code := upload(); code != 201 {
					t.Fatalf("admin: %d", code)
				}
				api.roles = "system_user"
				if code := upload(); code != 403 {
					t.Fatalf("demoted admin: %d", code)
				}
			} else {
				if code := upload(); code != 403 {
					t.Fatalf("non-admin: %d", code)
				}
				if len(api.values) != 0 {
					t.Fatal("unauthorized mutation")
				}
			}
			r := httptest.NewRequest("GET", "/stickers", nil)
			r.Header.Set("Mattermost-User-ID", "user")
			w := httptest.NewRecorder()
			p.ServeHTTP(nil, w, r)
			if w.Code != 200 {
				t.Fatal("catalog must remain readable", w.Code)
			}
		})
	}
}

func TestPNGOnlyAndResize(t *testing.T) {
	webp, err := os.ReadFile("../sources/original-webp/cumemoji_stickers/001.webp")
	if err != nil {
		t.Fatal(err)
	}
	if validate(webp) == nil {
		t.Fatal("accepted WebP")
	}
	if validate([]byte{0xff, 0xd8, 0xff}) == nil {
		t.Fatal("accepted JPEG")
	}
	source := image.NewNRGBA(image.Rect(0, 0, 512, 256))
	for y := 64; y < 192; y++ {
		for x := 128; x < 384; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, source); err != nil {
		t.Fatal(err)
	}
	normalized, err := normalizePNG(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := png.Decode(bytes.NewReader(normalized))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 192 || decoded.Bounds().Dy() != 96 {
		t.Fatal(decoded.Bounds())
	}
	if _, _, _, alpha := decoded.At(0, 0).RGBA(); alpha != 0 {
		t.Fatal("lost transparency")
	}
	if red, _, _, alpha := decoded.At(96, 48).RGBA(); red != 65535 || alpha != 65535 {
		t.Fatal("lost opaque content")
	}
}
