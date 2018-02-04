# odooChatLite
Alternative client for odoo livechat witch basic functionality. Require jQuery 1.x or above.

Usage 

```js
  odooChat.init('http://your.odoo.server', chatChannelId, chatSettings);
```

Available settings

```js
  chatSettings = {
    chatPrefix: 'oc_', //prefix for every chat element id
    buttonName: 'Start Chat!',
    chatButtonId: 'chat_start',
    chatWindowId: 'chat_window',
    chatHeaderId: 'chat_header',
    chatMessagesId: 'chat_messages',
    chatInputId: 'chat_input',
    chatCloseBtnId: 'chat_close',
    inputPlaceholder: 'Write something...',
    headerMsg: 'Customer Support',
    chatApi: {
        guestName: 'Guest',
        errorDelay: 10000
    }
  };
```
