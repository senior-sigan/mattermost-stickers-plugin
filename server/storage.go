package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const imagePrefix = "sticker_image_"
const metaPrefix = "sticker_meta_"
const legacyPrefix = "png_sticker_"

// The metadata is the commit record: never publish it before verifying the PNG.
// Legacy records are deliberately retained, including after a successful migration.
func (p *Plugin) persistSticker(sticker Sticker) error {
	if stickerID(sticker.Data) != sticker.ID {
		return fmt.Errorf("sticker checksum mismatch: %s", sticker.ID)
	}
	if err := validate(sticker.Data); err != nil {
		return err
	}
	if err := p.API.KVSet(imagePrefix+sticker.ID, sticker.Data); err != nil {
		return err
	}
	stored, err := p.API.KVGet(imagePrefix + sticker.ID)
	if err != nil {
		return err
	}
	if !bytes.Equal(stored, sticker.Data) {
		return fmt.Errorf("sticker write verification failed: %s", sticker.ID)
	}
	sticker.Data = nil
	metadata, marshalErr := json.Marshal(sticker)
	if marshalErr != nil {
		return marshalErr
	}
	if err := p.API.KVSet(metaPrefix+sticker.ID, metadata); err != nil {
		return err
	}
	stored, err = p.API.KVGet(metaPrefix + sticker.ID)
	if err != nil {
		return err
	}
	if !bytes.Equal(stored, metadata) {
		return fmt.Errorf("metadata write verification failed: %s", sticker.ID)
	}
	return nil
}

func sortCatalog(items []Sticker) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Pack != items[j].Pack {
			return items[i].Pack < items[j].Pack
		}
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		return items[i].ID < items[j].ID
	})
}

func (p *Plugin) saveSticker(sticker Sticker) error {
	p.catalogMu.Lock()
	defer p.catalogMu.Unlock()
	if err := p.persistSticker(sticker); err != nil {
		return err
	}
	if p.cachedCatalog != nil {
		sticker.Data = nil
		found := false
		for i := range p.cachedCatalog {
			if p.cachedCatalog[i].ID == sticker.ID {
				p.cachedCatalog[i] = sticker
				found = true
				break
			}
		}
		if !found {
			p.cachedCatalog = append(p.cachedCatalog, sticker)
		}
		sortCatalog(p.cachedCatalog)
	}
	return nil
}

func (p *Plugin) catalog() ([]Sticker, error) {
	p.catalogMu.Lock()
	defer p.catalogMu.Unlock()
	if p.cachedCatalog != nil && time.Now().Before(p.catalogExpires) {
		return append([]Sticker{}, p.cachedCatalog...), nil
	}
	// Snapshot keys before migration adds records; changing pagination mid-scan
	// could otherwise skip existing stickers. No binary values are read here.
	keys := []string{}
	for page := 0; ; page++ {
		batch, err := p.API.KVList(page, 100)
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if len(batch) < 100 {
			break
		}
	}
	all := map[string]Sticker{}
	for _, key := range keys {
		if !strings.HasPrefix(key, metaPrefix) {
			continue
		}
		data, err := p.API.KVGet(key)
		if err != nil {
			return nil, err
		}
		var item Sticker
		if err := json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		if key != metaPrefix+item.ID || len(item.ID) != 64 || item.Data != nil {
			return nil, fmt.Errorf("invalid metadata: %s", key)
		}
		all[item.ID] = item
	}
	for _, key := range keys {
		if !strings.HasPrefix(key, legacyPrefix) {
			continue
		}
		id := strings.TrimPrefix(key, legacyPrefix)
		if _, migrated := all[id]; migrated {
			continue
		}
		data, err := p.API.KVGet(key)
		if err != nil {
			return nil, err
		}
		var item Sticker
		if err := json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		if item.ID != id {
			return nil, fmt.Errorf("legacy sticker ID mismatch: %s", key)
		}
		if err := p.persistSticker(item); err != nil {
			return nil, fmt.Errorf("migrate %s: %w", key, err)
		}
		item.Data = nil
		all[id] = item
	}
	for id, item := range p.bundled {
		item.Data = nil
		all[id] = item
	}
	result := make([]Sticker, 0, len(all))
	for _, item := range all {
		result = append(result, item)
	}
	sortCatalog(result)
	p.cachedCatalog = result
	// Other Mattermost nodes eventually see uploads too; refresh reads metadata only.
	p.catalogExpires = time.Now().Add(time.Minute)
	return append([]Sticker{}, result...), nil
}
