package tests

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestInstallableBundle(t *testing.T) {
	archive := os.Getenv("PLUGIN_BUNDLE")
	if archive == "" {
		t.Skip("set PLUGIN_BUNDLE to validate a built archive")
	}
	f, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	r := tar.NewReader(gz)
	dir := t.TempDir()
	for {
		h, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if !filepath.IsLocal(h.Name) {
			t.Fatalf("unsafe path: %s", h.Name)
		}
		for _, part := range strings.Split(h.Name, "/") {
			if strings.HasPrefix(part, "._") || part == ".DS_Store" {
				t.Fatalf("macOS metadata in bundle: %s", h.Name)
			}
		}
		if len(h.PAXRecords) != 0 {
			t.Fatalf("unexpected extended metadata: %s", h.Name)
		}
		path := filepath.Join(dir, h.Name)
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(path, 0755); err != nil {
				t.Fatal(err)
			}
		case tar.TypeReg:
			if strings.HasPrefix(h.Name, "assets/stickers/") && !strings.HasSuffix(h.Name, ".png") {
				t.Fatalf("non-PNG sticker in bundle: %s", h.Name)
			}
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(r)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, data, os.FileMode(h.Mode)); err != nil {
				t.Fatal(err)
			}
		default:
			t.Fatalf("unsupported archive entry: %s", h.Name)
		}
	}
	manifest, _, err := model.FindManifest(dir)
	if err != nil {
		t.Fatalf("Mattermost cannot find manifest: %v", err)
	}
	if !model.IsValidPluginId(manifest.Id) {
		t.Fatal("invalid plugin ID")
	}
	if manifest.Server == nil || manifest.Webapp == nil {
		t.Fatal("missing components")
	}
	for _, binary := range manifest.Server.Executables {
		info, err := os.Stat(filepath.Join(dir, binary))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode()&0111 == 0 {
			t.Fatalf("binary is not executable: %s", binary)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, manifest.Webapp.BundlePath)); err != nil {
		t.Fatal(err)
	}
}
