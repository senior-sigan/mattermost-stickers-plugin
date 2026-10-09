import React from 'react';
import ReactDOM from 'react-dom';
import {createRoot} from 'react-dom/client';
window.React = React; window.ReactDOM = ReactDOM;
window.state = {entities: {general: {config: {SiteURL: location.origin}}, channels: {currentChannelId: 'channel1'}, users: {currentUserId: 'user1'}, posts: {posts: {thread1: {channel_id: 'channel2', root_id: ''}}}}, views: {rhs: {selectedPostId: 'thread1'}}};
const listeners = new Set();
window.updateStore = () => listeners.forEach((listener) => listener());
const store = {getState: () => window.state, subscribe: (listener) => {listeners.add(listener); return () => listeners.delete(listener);}};
window.registerPlugin = (_id, plugin) => {
    const roots = [];
    const postTypes = {};
    plugin.initialize({
        registerRootComponent: (Component) => {const root = createRoot(document.getElementById('root')); root.render(<Component/>); roots.push(root);},
        registerPostEditorActionComponent: (Component) => {const root = createRoot(document.getElementById('fallback')); root.render(<Component draft={{channelId: 'channel3', rootId: 'thread3'}}/>); roots.push(root);},
        registerPostTypeComponent: (type, Component) => {postTypes[type] = Component;},
        registerAdminConsoleCustomSetting: (key, Component) => {
            window.renderAdminSettings = (disabled = false) => {
                const container = document.createElement('section'); container.id = 'admin-settings'; container.dataset.setting = key;
                document.querySelector('main').prepend(container);
                const root = createRoot(container); root.render(<Component disabled={disabled}/>); roots.push(root);
            };
        },
    }, store);
    // Match the 11.7.3 layout: custom body inside AutoHeight, attachments outside.
    window.renderPost = (post) => {
        const container = document.createElement('article');
        container.className = 'post__body'; container.id = post.id;
        const message = document.createElement('div'); message.className = 'AutoHeight';
        const attachment = document.createElement('div'); attachment.className = 'file-view--single';
        attachment.textContent = 'Обычное вложение';
        container.append(message, attachment); document.querySelector('main').prepend(container);
        const Component = postTypes[post.type];
        if (Component) {const root = createRoot(message); root.render(<div><Component post={post}/></div>); roots.push(root);}
    };
    window.unloadPlugin = () => {roots.forEach((root) => root.unmount()); plugin.uninitialize();};
};
