package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMigrationAndCachedCatalog(t *testing.T) {
	png, err := os.ReadFile("../stickers/cumemoji_stickers/001.png")
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{values: map[string][]byte{}}
	originals := map[string][]byte{}
	// Cross KVList page boundaries. Distinct valid PNG payloads preserve their IDs.
	for i := 0; i < 205; i++ {
		data := append(append([]byte{}, png...), []byte(fmt.Sprint(i))...)
		item := Sticker{ID: stickerID(data), Name: fmt.Sprintf("%03d", i), Pack: "Uploaded", Data: data}
		encoded, _ := json.Marshal(item)
		api.values[legacyPrefix+item.ID] = encoded
		originals[item.ID] = data
	}
	p := &Plugin{}
	p.SetAPI(api)
	items, err := p.catalog()
	if err != nil || len(items) != 205 {
		t.Fatalf("migration: %d %v", len(items), err)
	}
	for _, item := range items {
		if item.Data != nil || !bytes.Equal(api.values[imagePrefix+item.ID], originals[item.ID]) {
			t.Fatal("changed PNG or leaked data")
		}
		if len(api.values[legacyPrefix+item.ID]) == 0 {
			t.Fatal("deleted legacy record")
		}
	}
	api.gets = nil
	items[0].Name = "mutated caller copy"
	cached, err := p.catalog()
	if err != nil || len(api.gets) != 0 || cached[0].Name == items[0].Name {
		t.Fatal("cache not isolated or performed KV reads")
	}
	p.catalogExpires = time.Time{}
	api.gets = nil
	if _, err := p.catalog(); err != nil {
		t.Fatal(err)
	}
	for _, key := range api.gets {
		if !strings.HasPrefix(key, metaPrefix) {
			t.Fatalf("refresh read image or legacy JSON: %s", key)
		}
	}
	restarted := &Plugin{}
	restarted.SetAPI(api)
	if items, err := restarted.catalog(); err != nil || len(items) != 205 {
		t.Fatal("restart failed", err)
	}
}

func TestMigrationResumesAfterWriteFailure(t *testing.T) {
	data, err := os.ReadFile("../stickers/cumemoji_stickers/001.png")
	if err != nil {
		t.Fatal(err)
	}
	item := Sticker{ID: stickerID(data), Name: "original", Pack: "Uploaded", Data: data}
	encoded, _ := json.Marshal(item)
	for _, prefix := range []string{imagePrefix, metaPrefix} {
		t.Run(prefix, func(t *testing.T) {
			api := &fakeAPI{values: map[string][]byte{legacyPrefix + item.ID: encoded}, failSet: prefix + item.ID}
			p := &Plugin{}
			p.SetAPI(api)
			if _, err := p.catalog(); err == nil {
				t.Fatal("ignored failure")
			}
			if !bytes.Equal(api.values[legacyPrefix+item.ID], encoded) || p.cachedCatalog != nil {
				t.Fatal("legacy changed or partial cache published")
			}
			api.failSet = ""
			if items, err := p.catalog(); err != nil || len(items) != 1 {
				t.Fatal("retry failed", err)
			}
			if !bytes.Equal(api.values[imagePrefix+item.ID], data) {
				t.Fatal("PNG changed")
			}
		})
	}
}

func TestUploadRefreshesWarmCache(t *testing.T) {
	data, err := os.ReadFile("../stickers/cumemoji_stickers/001.png")
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{values: map[string][]byte{}}
	p := &Plugin{}
	p.SetAPI(api)
	if _, err := p.catalog(); err != nil {
		t.Fatal(err)
	}
	item := Sticker{ID: stickerID(data), Name: "New", Pack: "Uploaded", Data: data}
	if err := p.saveSticker(item); err != nil {
		t.Fatal(err)
	}
	api.gets = nil
	if items, err := p.catalog(); err != nil || len(items) != 1 || items[0].Data != nil || len(api.gets) != 0 {
		t.Fatal("warm cache not updated", err)
	}
	if len(api.values) != 2 {
		t.Fatal("upload should store exactly PNG and metadata")
	}
}

func TestMigrationRejectsCorruptLegacy(t *testing.T) {
	item := Sticker{ID: strings.Repeat("a", 64), Name: "broken", Data: []byte("not PNG")}
	encoded, _ := json.Marshal(item)
	api := &fakeAPI{values: map[string][]byte{legacyPrefix + item.ID: encoded}}
	p := &Plugin{}
	p.SetAPI(api)
	if _, err := p.catalog(); err == nil {
		t.Fatal("accepted corrupt legacy")
	}
	if len(api.values) != 1 {
		t.Fatal("modified corrupt legacy")
	}
}

func TestConcurrentCatalogAndUploads(t *testing.T) {
	data, err := os.ReadFile("../stickers/cumemoji_stickers/001.png")
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{values: map[string][]byte{}}
	p := &Plugin{}
	p.SetAPI(api)
	if _, err := p.catalog(); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			png := append(append([]byte{}, data...), byte(i))
			item := Sticker{ID: stickerID(png), Name: fmt.Sprint(i), Pack: "Uploaded", Data: png}
			if err := p.saveSticker(item); err != nil {
				t.Error(err)
			}
			if _, err := p.catalog(); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	if items, err := p.catalog(); err != nil || len(items) != 20 {
		t.Fatal("lost concurrent upload", err)
	}
}
