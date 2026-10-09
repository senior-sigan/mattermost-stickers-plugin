import {test, expect} from '@playwright/test';
import {readdir, readFile} from 'node:fs/promises';
const images = (await readdir('stickers/cumemoji_stickers')).filter((name) => name.endsWith('.png')).sort();
const catalog = images.map((name, i) => ({id: `${i}`, name: name.replace(/\.png$/i, ''), pack: 'cumemoji_stickers'}));

async function fixture(page, options = {}) {
    const posts = [];
    const uploads = [];
    let extra = [];
    await page.route('**/plugins/ru.senior-sigan.stickers/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/image/')) {
            const id = url.split('/').at(-1);
            await route.fulfill({contentType: 'image/png', body: await readFile(`stickers/cumemoji_stickers/${images[Number(id)] || images[0]}`)});
        } else if (route.request().method() === 'POST') {
            uploads.push(route.request().headers()['x-sticker-name']);
            extra = [{id: 'added', name: 'Added', pack: 'Uploaded'}];
            await route.fulfill({json: extra[0]});
        } else { await route.fulfill({json: [...catalog, ...extra]}); }
    });
    await page.route('**/api/v4/files', (route) => route.fulfill({json: {file_infos: [{id: 'file1'}]}}));
    await page.route('**/api/v4/posts', async (route) => {
        posts.push(route.request().postDataJSON());
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.fulfill(options.fail ? {status: 403, json: {message: 'Posting denied'}} : {json: {id: 'post1'}});
    });
    await page.goto('/');
    return {posts, uploads};
}

test('button beside emoji, five columns, scroll, one-click send, draft untouched', async ({page}) => {
    const {posts} = await fixture(page);
    const button = page.locator('#create_post').getByRole('button', {name: 'Выбрать стикер'});
    await expect(button).toBeVisible();
    expect(await button.evaluate((element) => element.previousElementSibling.id)).toBe('emojiPickerButton');
    await button.click();
    const dialog = page.getByRole('dialog', {name: 'Стикеры'});
    await expect(dialog.locator('input[type=file]')).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: /Добавить/})).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: /^Отправить /})).toHaveCount(catalog.length);
    expect(await page.locator('.mm-stickers-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(5);
    expect(await page.locator('.mm-stickers-grid').evaluate((grid) => grid.scrollHeight > grid.clientHeight)).toBe(true);
    await page.screenshot({path: 'build/stickers-preview.png'});
    await dialog.getByRole('button', {name: 'Отправить 001', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toEqual([{user_id: 'user1', channel_id: 'channel1', root_id: '', type: 'custom_sigan_sticker', message: '', file_ids: ['file1'],
        props: {stickers: {version: 1, id: '0', name: '001', pack: 'cumemoji_stickers', file_id: 'file1'}},
    }]);
    await expect(page.locator('#post_textbox')).toHaveValue('Несохранённый черновик');
});

test('thread, keyboard closing and plugin cleanup', async ({page}) => {
    const {posts} = await fixture(page);
    await page.locator('#rhs').getByRole('button', {name: 'Выбрать стикер'}).click();
    await page.getByRole('button', {name: 'Отправить 001', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(posts[0].channel_id).toBe('channel2'); expect(posts[0].root_id).toBe('thread1');
    await page.getByRole('button', {name: 'Открыть стикеры', exact: true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.unloadPlugin());
    await expect(page.getByRole('button', {name: 'Выбрать стикер'})).toHaveCount(0);
});

test('admin setting uploads PNG immediately and refreshes the shared catalog', async ({page}) => {
    const {uploads} = await fixture(page);
    await page.evaluate(() => window.renderAdminSettings());
    const admin = page.locator('#admin-settings');
    await expect(admin).toHaveAttribute('data-setting', 'StickerLibrary');
    await expect(admin).toContainText('Стикеров в каталоге: 108');
    await admin.locator('input[type=file]').setInputFiles('stickers/cumemoji_stickers/001.png');
    await expect(admin.getByRole('status')).toContainText('Обработано файлов: 1');
    await expect(admin).toContainText('Стикеров в каталоге: 109');
    expect(uploads).toEqual(['001.png']);
    await page.locator('#create_post').getByRole('button', {name: 'Выбрать стикер'}).click();
    await expect(page.getByRole('button', {name: 'Отправить Added'})).toBeAttached();
});

test('admin UI reports forbidden upload and respects read-only settings', async ({page}) => {
    await fixture(page);
    await page.route('**/plugins/ru.senior-sigan.stickers/stickers', (route) => route.request().method() === 'POST' ?
        route.fulfill({status: 403, json: {message: 'Only system administrators can upload stickers'}}) : route.fallback());
    await page.evaluate(() => window.renderAdminSettings());
    await page.locator('#admin-settings input[type=file]').setInputFiles('stickers/cumemoji_stickers/001.png');
    await expect(page.locator('#admin-settings').getByRole('alert')).toContainText('Only system administrators');
    await expect(page.locator('#admin-settings').getByRole('button')).toBeEnabled();
    await page.reload();
    await page.evaluate(() => window.renderAdminSettings(true));
    await expect(page.locator('#admin-settings').getByRole('button')).toBeDisabled();
});

test('posting errors preserve picker, context switches cannot send to wrong channel', async ({page}) => {
    const {posts} = await fixture(page, {fail: true});
    await page.locator('#create_post').getByRole('button', {name: 'Выбрать стикер'}).click();
    await page.getByRole('button', {name: 'Отправить 001', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('Posting denied');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => {window.state.entities.channels.currentChannelId = 'changed'; window.updateStore();});
    await page.getByRole('button', {name: 'Отправить 001', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('Канал или тред изменился');
    expect(posts).toHaveLength(1);
});

test('narrow screens keep picker within viewport and close on outside click', async ({page}) => {
    await page.setViewportSize({width: 375, height: 740}); await fixture(page);
    await page.locator('#create_post').getByRole('button', {name: 'Выбрать стикер'}).click();
    const bounds = await page.getByRole('dialog').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
    await page.locator('h1').click(); await expect(page.getByRole('dialog')).toHaveCount(0);
});
