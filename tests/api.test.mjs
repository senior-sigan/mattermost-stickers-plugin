import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorContext, siteBase, sendSticker, stickerPostData, stickerPostType} from '../webapp/api.mjs';

test('resolves main channel and thread independently, refuses unknown contexts', () => {
    const state = {entities: {channels: {currentChannelId: 'main'}, posts: {posts: {root: {channel_id: 'other'}}}}, views: {rhs: {selectedPostId: 'root'}}};
    const textbox = (id, form = '') => ({id, closest: () => ({id: form})});
    assert.deepEqual(editorContext(textbox('post_textbox', 'create_post'), state), {channelId: 'main', rootId: ''});
    assert.deepEqual(editorContext(textbox('reply_textbox'), state), {channelId: 'other', rootId: 'root'});
    assert.equal(editorContext(textbox('post_textbox'), state), null);
    assert.equal(editorContext(textbox('edit_textbox'), state), null);
    assert.equal(editorContext(textbox('modal_textbox'), state), null);
    state.entities.posts.posts = {};
    assert.equal(editorContext(textbox('reply_textbox'), state), null);
});

test('supports a Mattermost subpath', () => {
    global.window = {location: {origin: 'https://chat.example.com'}};
    assert.equal(siteBase({getState: () => ({entities: {general: {config: {SiteURL: 'https://chat.example.com/chat/'}}}})}), '/chat');
});

test('sends a custom sticker with a PNG attachment for native clients to the correct thread', async () => {
    global.document = {cookie: 'MMCSRF=token'};
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({url, opts});
        if (url.includes('/image/')) { return new Response(new Blob(['image'], {type: 'image/png'})); }
        if (url.endsWith('/files')) { return Response.json({file_infos: [{id: 'file1'}]}); }
        return Response.json({id: 'post1'});
    };
    await sendSticker('/chat', {id: 's'}, {channelId: 'channel', rootId: 'thread'}, 'user', {});
    assert.equal(calls[1].opts.body.get('channel_id'), 'channel');
    assert.equal(calls[1].opts.body.get('files').name, 's.png');
    assert.equal(calls[1].opts.body.get('files').type, 'image/png');
    assert.equal(calls[2].opts.headers['X-CSRF-Token'], 'token');
    assert.deepEqual(JSON.parse(calls[2].opts.body), {user_id: 'user', channel_id: 'channel', root_id: 'thread', type: stickerPostType, message: '', file_ids: ['file1'],
        props: {stickers: {version: 1, id: 's', name: 'Стикер', pack: '', file_id: 'file1'}},
    });
});

test('custom renderer only accepts a single attached PNG and never a catalog URL', () => {
    const post = {type: stickerPostType, file_ids: ['file1'], props: {stickers: {version: 1, file_id: 'file1', name: '001'}}};
    assert.deepEqual(stickerPostData(post), {fileID: 'file1', name: '001'});
    assert.equal(stickerPostData({...post, type: ''}), null);
    assert.equal(stickerPostData({...post, file_ids: ['different']}), null);
    assert.equal(stickerPostData({...post, file_ids: ['file1', 'file2']}), null);
    assert.equal(stickerPostData({...post, metadata: {files: [{id: 'file1', mime_type: 'image/jpeg'}]}}), null);
    assert.equal(stickerPostData({...post, metadata: {files: [{id: 'file1', mime_type: 'image/png', archived: true}]}}), null);
});
