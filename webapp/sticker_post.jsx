import React, {useState} from 'react';
import {stickerPostData} from './api.mjs';

function StickerImage({source, name}) {
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    // Until the original PNG loads, Mattermost's standard attachment remains
    // visible. CSS suppresses only that post's duplicate attachment afterwards.
    return <div className={`mm-sticker-post${loaded && !failed ? ' mm-sticker-post--ready' : ''}`}>
        <img className='mm-sticker-post__image' src={source} alt={`Стикер: ${name}`} draggable={false}
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>
    </div>;
}

export default function StickerPost({post, base}) {
    const sticker = stickerPostData(post);
    if (!sticker) { return null; }
    // Use the authenticated file attached to this post, not the mutable plugin
    // catalog: history still works when a pack changes and channel ACLs apply.
    const source = `${base}/api/v4/files/${encodeURIComponent(sticker.fileID)}`;
    return <StickerImage key={source} source={source} name={sticker.name}/>;
}
