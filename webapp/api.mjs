export const pluginID = 'ru.senior-sigan.stickers';
export const stickerPostType = 'custom_sigan_sticker';

export function stickerPostData(post) {
    const sticker = post?.props?.stickers;
    if (post?.type !== stickerPostType || sticker?.version !== 1 || post.file_ids?.length !== 1 ||
        typeof sticker.file_id !== 'string' || !sticker.file_id || sticker.file_id !== post.file_ids[0]) {
        return null;
    }
    const file = post.metadata?.files?.find((item) => item.id === sticker.file_id);
    if (file && (file.archived || file.mime_type !== 'image/png')) { return null; }
    return {fileID: sticker.file_id, name: typeof sticker.name === 'string' ? sticker.name : 'Стикер'};
}

export function siteBase(store) {
    const siteURL = store.getState().entities?.general?.config?.SiteURL;
    return siteURL ? new URL(siteURL, window.location.origin).pathname.replace(/\/$/, '') : (window.basename || '');
}

export function csrfHeaders() {
    const cookie = document.cookie.split('; ').find((part) => part.startsWith('MMCSRF='));
    return {'X-Requested-With': 'XMLHttpRequest', ...(cookie ? {'X-CSRF-Token': decodeURIComponent(cookie.slice(7))} : {})};
}

export async function request(path, options = {}) {
    const response = await fetch(path, {credentials: 'same-origin', ...options, headers: {...csrfHeaders(), ...options.headers}});
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Request failed (${response.status})`);
    }
    return response;
}

// Resolve only editor contexts verified against Mattermost 11.7.3. Never guess
// the current channel for a thread, modal, or message being edited.
export function editorContext(textbox, state) {
    if (textbox.id === 'post_textbox' && textbox.closest('form')?.id === 'create_post') {
        const channelId = state.entities?.channels?.currentChannelId;
        return channelId ? {channelId, rootId: ''} : null;
    }
    if (textbox.id === 'reply_textbox') {
        const rootId = state.views?.rhs?.selectedPostId;
        const post = state.entities?.posts?.posts?.[rootId];
        if (post && !post.delete_at) { return {channelId: post.channel_id, rootId: post.root_id || rootId}; }
    }
    return null;
}

export async function sendSticker(base, sticker, context, userId, pendingFile) {
    let fileId = pendingFile?.stickerId === sticker.id && pendingFile?.channelId === context.channelId ? pendingFile.id : null;
    if (!fileId) {
        const image = await request(`${base}/plugins/${pluginID}/image/${sticker.id}`);
        const form = new FormData();
        form.append('channel_id', context.channelId);
        form.append('files', await image.blob(), `${sticker.id}.png`);
        const uploaded = await (await request(`${base}/api/v4/files`, {method: 'POST', body: form})).json();
        fileId = uploaded.file_infos?.[0]?.id;
        if (!fileId) { throw new Error('Server did not return an uploaded file'); }
        Object.assign(pendingFile, {id: fileId, stickerId: sticker.id, channelId: context.channelId});
    }
    await request(`${base}/api/v4/posts`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: userId, channel_id: context.channelId, root_id: context.rootId || '',
            type: stickerPostType, message: '', file_ids: [fileId],
            props: {stickers: {version: 1, id: sticker.id, name: sticker.name || 'Стикер', pack: sticker.pack || '', file_id: fileId}},
        }),
    });
}
