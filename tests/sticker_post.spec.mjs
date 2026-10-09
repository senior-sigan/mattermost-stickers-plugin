import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const sticker = (id, fileID = 'file1') => ({id, type: 'custom_sigan_sticker', file_ids: [fileID],
    props: {stickers: {version: 1, file_id: fileID, name: '001'}}});

test('custom PNG has no frame, caps dimensions, hides only its duplicate, restores fallback on unload', async ({page}) => {
    const fileRequests = [];
    await page.route('**/api/v4/files/file1', async (route) => {
        fileRequests.push(route.request().url());
        await route.fulfill({contentType: 'image/png', body: await readFile('stickers/cumemoji_stickers/001.png')});
    });
    await page.goto('/');
    await page.evaluate((post) => {window.renderPost(post); window.renderPost({id: 'ordinary', type: '', file_ids: ['file2']});}, sticker('custom'));
    const image = page.locator('#custom .mm-sticker-post__image');
    await expect(image).toBeVisible();
    await expect(page.locator('#custom > .file-view--single')).toBeHidden();
    await expect(page.locator('#ordinary > .file-view--single')).toBeVisible();
    const style = await image.evaluate((img) => {
        const css = getComputedStyle(img); const bounds = img.getBoundingClientRect();
        return {width: bounds.width, height: bounds.height, border: css.borderWidth, background: css.backgroundColor, shadow: css.boxShadow};
    });
    expect(style).toEqual({width: 192, height: 192, border: '0px', background: 'rgba(0, 0, 0, 0)', shadow: 'none'});
    expect(fileRequests).toHaveLength(1);
    await page.screenshot({path: 'build/custom-sticker-preview.png'});
    await page.evaluate(() => {document.body.style.background = '#292c33'; document.body.style.color = '#fff';});
    await expect(image).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.locator('#custom').evaluate((post) => {post.style.width = '120px';});
    expect((await image.boundingBox()).width).toBeLessThanOrEqual(120);
    await page.evaluate(() => window.unloadPlugin());
    await expect(page.locator('#custom > .file-view--single')).toBeVisible();
});

test('failed images and malformed custom posts keep normal attachments visible', async ({page}) => {
    await page.route('**/api/v4/files/missing', (route) => route.fulfill({status: 404, body: 'Not found'}));
    await page.goto('/');
    await page.evaluate((post) => {
        window.renderPost(post);
        window.renderPost({id: 'malformed', type: 'custom_sigan_sticker', file_ids: ['file1'], props: {}});
    }, sticker('failed', 'missing'));
    await expect(page.locator('#failed > .file-view--single')).toBeVisible();
    await expect(page.locator('#failed .mm-sticker-post')).toBeHidden();
    await expect(page.locator('#malformed > .file-view--single')).toBeVisible();
    await expect(page.locator('.mm-sticker-post--ready')).toHaveCount(0);
});
