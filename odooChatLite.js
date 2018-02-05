var odooChat =
    (function (jQuery) {
        'use strict';

        var session = (function() {
            var session = {};

            var sessionId = null,
                originServer = null;

            session.getSession = function(server) {
                originServer = server;

                return generateSessionId();
            };

            function generateSessionId() {
                return session.rpc('/gen_session_id', {})
                    .then(function(response) {
                        if (response.session_id) {
                            sessionId = response.session_id;
                        }
                    });
            }

            session.rpc = function(route, params) {
                var rpcParams = JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    id: Math.floor((Math.random() * 999999) * 1000),
                    params: params
                });

                return jQuery.ajax({
                    url: originServer + route,
                    method: 'GET',
                    crossDomain: true,
                    dataType: 'jsonp',
                    jsonp: 'jsonp',
                    data: {
                        session_id: sessionId,
                        r: rpcParams
                    }
                });
            };

            return session;
        })();

        var chatApi = (function() {
            var chat = {};

            var channel_uuid = null,
                chatChannel = null,
                lastPresence = 0,
                lastPooledId = 0,
                lastMessageId = 0,
                chatHistory = [],
                pooling = false;

            chat.settings = {
                guestName: 'Guest',
                errorDelay: 10000
            };

            chat.init = function(originServer, channel, settings) {
                chatChannel = channel || 1;

                applyChatApiSettings(settings);

                session.getSession(originServer).then(initChat);

                window.addEventListener('sendChatMessage', sendMessage, false);
                window.addEventListener('openChatSession', openAvailableChannel, false);
                window.addEventListener('loadChatSession', loadAvailableChannel, false);
            };

            function applyChatApiSettings(settings) {
                for (var key in settings) {
                    if (!settings.hasOwnProperty(key)) continue;

                    if (typeof settings[key] !== 'object') {
                        chat.settings[key] = settings[key] || chat.settings[key];
                    }

                }
            }

            function initChat() {
                return session.rpc('/im_livechat/init', {
                    channel_id: chatChannel
                }).then(function(response) {
                    if (checkIsChatAvailable(response)) {
                        sendEventChatIsAvailable();
                    }
                });
            }

            function checkIsChatAvailable(response) {
                return (response.result && response.result.available_for_me === true)
            }

            function sendEventChatIsAvailable() {
                var chatEvent = new CustomEvent('chatIsAvailableEvent', {
                    detail: {},
                    bubbles: false,
                    cancelable: true
                });

                window.dispatchEvent(chatEvent);
            }

            function openAvailableChannel() {
                if (isChannelActive()) {
                    getChatHistory();
                } else {
                    getChannel();
                }
            }

            function loadAvailableChannel() {
                if (isChannelActive()) {
                    loadChatHistory();
                }
            }

            function getChannel() {
                session.rpc('/im_livechat/get_session', {
                    channel_id: chatChannel,
                    anonymous_name: chat.settings.guestName
                }).then(function(response) {
                    if (response.result && response.result.uuid) {
                        channel_uuid = response.result.uuid;

                        if (window.localStorage) {
                            window.localStorage.setItem('chat.channel', channel_uuid);
                        }
                    }
                });
            }

            function isChannelActive() {
                if (window.localStorage) {
                    if (window.localStorage['chat.lastPresence']) {
                        lastPresence = window.localStorage['chat.lastPresence'];
                    }

                    if (ifDaysSince(lastPresence, 14)) {
                        window.localStorage.removeItem('chat.channel');
                        window.localStorage.removeItem('chat.lastPresence');
                        window.localStorage.removeItem('chat.lastPooledId');
                        return false;
                    }

                    if (window.localStorage['chat.channel']) {
                        channel_uuid = window.localStorage['chat.channel'];
                    }

                    if (window.localStorage['chat.lastPooledId']) {
                        lastPooledId = window.localStorage['chat.lastPooledId'];
                    }

                    return channel_uuid && lastPresence && lastPooledId;
                }
                return false;
            }

            function ifDaysSince(date, days) {
                var diff = Math.abs(new Date().getTime() - date);
                var daysSince = diff / 1000 / 60 / 60 / 24;
                return daysSince > days;
            }

            function getChatHistory() {
                if (chatHistory.length > 0) {
                    lastMessageId = 0;
                    addMessagesFromHistory(chatHistory);
                    longpooling();
                } else {
                    session.rpc('/mail/chat_history',{
                        uuid: channel_uuid,
                        limit: 50
                    }).then(function(response) {
                        if (response.result !== undefined && response.result.length > 0) {
                            chatHistory = response.result;
                            addMessagesFromHistory(chatHistory);
                            longpooling();
                        } else {
                            getChannel();
                        }
                    });
                }
            }


            function loadChatHistory() {
                session.rpc('/mail/chat_history',{
                    uuid: channel_uuid,
                    limit: 50
                }).then(function(response) {
                    if (response.result !== undefined && response.result.length > 0) {
                        chatHistory = response.result;
                        longpooling();
                    } else {
                        getChannel();
                    }
                });

            }

            function sendMessage(sendMessageEvent) {
                if (!sendMessageEvent.detail && !sendMessageEvent.detail.message) {
                    return;
                }

                lastPresence = new Date().getTime();

                if (window.localStorage) {
                    window.localStorage.setItem('chat.lastPresence', lastPresence.toString());
                }

                var message = sendMessageEvent.detail.message;

                var sanitizeMsg = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

                session.rpc('/mail/chat_post', {
                    uuid: channel_uuid,
                    message_content: sanitizeMsg
                }).then(function() {
                    longpooling();
                });
            }

            function longpooling() {
                if (pooling) return;

                pooling = true;

                session.rpc('/longpolling/poll', {
                    channels: [channel_uuid],
                    last: lastPooledId,
                    options: {
                        bus_inactivity: new Date().getTime() - lastPresence
                    }
                }).then(function(response) {
                    pooling = false;
                    longpooling();

                    addMessagesToChat(response);
                }, restartLongpoolingAfterError);
            }

            function addMessagesFromHistory(history) {
                if (history !== undefined) {
                    var revHistory = history.slice();
                    revHistory.reverse().forEach(function(element) {
                        if (element.body !== undefined && element.id !== undefined) {
                            var author = [0, false];
                            if (element.author_id instanceof Array && element.author_id.length > 1) {
                                author = element.author_id;
                            }
                            SendChatMessageEvent(element.body, author[0], author[1], element.id);
                        }
                    });
                }
            }

            function addMessagesToChat(response) {
                if (response.result !== undefined && response.result instanceof Array && response.result.length > 0) {
                    response.result.slice().forEach(function(element) {
                        if (element.id !== undefined && element.id > lastPooledId) {
                            lastPooledId = element.id;

                            if (window.localStorage) {
                                window.localStorage.setItem('chat.lastPooledId', lastPooledId.toString());
                            }

                            if (element.message !== undefined
                                && element.message.body !== undefined
                                && element.message.id !== undefined
                                && element.message.id > lastMessageId) {
                                var author = [0, false];
                                if (element.message.author_id instanceof Array) {
                                    author = element.message.author_id;
                                }

                                SendChatMessageEvent(element.message.body, author[0], author[1], element.message.id);

                                chatHistory.unshift({
                                    body: element.message.body,
                                    author_id: author.slice(),
                                    id: element.message.id
                                });
                            }
                        }
                    });
                }
            }

            function SendChatMessageEvent(message, authorId, authorName, messageId) {
                if (messageId > lastMessageId) {
                    authorId = authorId || 0;

                    if (authorName === false) {
                        authorName = chat.settings.guestName;
                    }

                    var messageEvent = new CustomEvent('incomingChatMessage', {
                        detail: {
                            message: message,
                            authorId: authorId,
                            authorName: authorName,
                            messageId: messageId
                        },
                        bubbles: false,
                        cancelable: true
                    });

                    lastMessageId = messageId;

                    window.dispatchEvent(messageEvent);
                }
            }

            function restartLongpoolingAfterError() {
                setTimeout(function() {
                    longpooling();
                }, chat.settings.errorDelay + (Math.floor((Math.random() * 20) + 1) * 1000));
            }

            return chat;
        })();

        return (function(){
            var chat = {};

            var lastMessageOwner = null,
                originServer = null,
                isChatOpened = false,
                chatButton = null,
                chatWindow = null,
                chatMessages = null,
                chatInput = null,
                chatClose = null;

            chat.settings = {
                chatPrefix: 'oc_',
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

            chat.init = function(erpUrl, chatChannel, settings) {
                originServer = erpUrl;

                applyChatSettings(settings);

                chatApi.init(erpUrl, chatChannel, chat.settings.chatApi);

                window.addEventListener('chatIsAvailableEvent', initChatButton, false);
                window.addEventListener('incomingChatMessage', addMessage, false);
                window.addEventListener('closeChatEvent', closeChat, false);
            };

            function applyChatSettings(settings) {
                for (var key in settings) {
                    if (!settings.hasOwnProperty(key)) continue;

                    if (typeof settings[key] === 'object') {
                        var subSettings = settings[key];
                        for (var subKey in subSettings) {
                            if (!subSettings.hasOwnProperty(subKey)) continue;
                            chat.settings[key][subKey] = subSettings[subKey] || chat.settings[key][subKey];
                        }
                    } else {
                        chat.settings[key] = settings[key] || chat.settings[key];
                    }

                }
            }

            function initChatButton() {
                renderChatButton();
                bindChatButton();

                if (window.localStorage && window.localStorage['chat.channel']) {
                    loadChatSession();
                }
            }

            function renderChatButton() {
                var buttonId = chat.settings.chatPrefix + chat.settings.chatButtonId;

                jQuery('body').append(function() {
                    return '<div id="'+ buttonId +'">'+ chat.settings.buttonName +'</button>';
                });
            }

            function bindChatButton() {
                var buttonId = chat.settings.chatPrefix + chat.settings.chatButtonId;

                chatButton = jQuery('#'+ buttonId);

                chatButton.on('click', function() {
                    openChatWindow();
                });
            }

            function openChatWindow() {
                if (!isChatOpened) {
                    isChatOpened = true;
                    lastMessageOwner = null;

                    renderChatWindow();
                    bindChatElements();
                    openChatSession();
                }
            }

            function renderChatWindow() {
                var chatWindowId = chat.settings.chatPrefix + chat.settings.chatWindowId;
                var chatHeaderId = chat.settings.chatPrefix + chat.settings.chatHeaderId;
                var chatCloseBtnId = chat.settings.chatPrefix + chat.settings.chatCloseBtnId;
                var chatInputId = chat.settings.chatPrefix + chat.settings.chatInputId;
                var chatMessagesId = chat.settings.chatPrefix + chat.settings.chatMessagesId;

                jQuery('body').append(function() {
                    var html = '<div id="'+ chatWindowId +'">';
                    html += '<div id="'+ chatHeaderId +'">';
                    html += '<span>'+ chat.settings.headerMsg +'</span>';
                    html += '<span id="'+ chatCloseBtnId +'">&#10005;</span>';
                    html += '</div>';
                    html += '<div id="'+ chatMessagesId +'"></div>';
                    html += '<textarea id="'+ chatInputId +'" placeholder="'+ chat.settings.inputPlaceholder +'" rows="1"></textarea>';
                    html += '</div>';

                    return html;
                });
            }

            function bindChatElements() {
                chatWindow = jQuery('#' + chat.settings.chatPrefix + chat.settings.chatWindowId);
                chatInput = jQuery('#' + chat.settings.chatPrefix + chat.settings.chatInputId);
                chatMessages = jQuery('#' + chat.settings.chatPrefix + chat.settings.chatMessagesId);
                chatClose = jQuery('#' + chat.settings.chatPrefix + chat.settings.chatCloseBtnId);

                chatInput.keyup(function(e) {
                    e = e || event;
                    if (e.keyCode === 13 && !e.shiftKey) {
                        var message = chatInput.val();
                        chatInput.val('');

                        if (message !== '') {
                            sendMessage(message);
                        }
                    }
                    return true;
                });

                chatClose.on('click', function(event) {
                    event.preventDefault();

                    var closeChatEvent = new CustomEvent('closeChatEvent', {
                        detail: {},
                        bubbles: false,
                        cancelable: true
                    });

                    window.dispatchEvent(closeChatEvent);
                });

                chatInput.focus();
            }

            function sendMessage(message) {
                var sendMessageEvent = new CustomEvent('sendChatMessage', {
                    detail: {
                        message: message
                    },
                    bubbles: false,
                    cancelable: true
                });

                window.dispatchEvent(sendMessageEvent);
            }

            function openChatSession() {
                var chatSession = new CustomEvent('openChatSession', {
                    detail: {},
                    bubbles: false,
                    cancelable: true
                });

                window.dispatchEvent(chatSession);
            }

            function loadChatSession() {
                var chatSession = new CustomEvent('loadChatSession', {
                    detail: {},
                    bubbles: false,
                    cancelable: true
                });

                window.dispatchEvent(chatSession);
            }

            function addMessage(messageEvent) {
                openChatWindow();

                var messageHtml = '';

                if (messageEvent.detail.authorId === lastMessageOwner) {
                    messageHtml = messageEvent.detail.message;

                    chatMessages.find('.message_content').last().append(messageHtml);
                } else {
                    var imgUrl = '';
                    if (messageEvent.detail.authorId === 0) {
                        imgUrl = originServer + '/mail/static/src/img/smiley/avatar.jpg';
                    } else {
                        imgUrl = originServer + '/web/image/res.partner/'+ messageEvent.detail.authorId +'/image_small';
                    }

                    messageHtml = '<div class="message_thread">';
                    messageHtml += 	'<div class="message_img">';
                    messageHtml += 		'<img src="'+ imgUrl +'" alt="'+ messageEvent.detail.authorName +'">';
                    messageHtml += 	'</div>';
                    messageHtml += 	'<div class="message_content">';
                    messageHtml += 		'<span class="owner">'+ messageEvent.detail.authorName +'</span>' + messageEvent.detail.message;
                    messageHtml += 	'</div>';
                    messageHtml += '</div>';

                    lastMessageOwner = messageEvent.detail.authorId;

                    chatMessages.append(messageHtml);
                }

                chatMessages.scrollTop(chatMessages[0].scrollHeight);
            }

            function closeChat() {
                if (isChatOpened) {
                    chatWindow.remove();
                    isChatOpened = false;
                }
            }

            return chat;
        })();

    })($ || jQuery);
