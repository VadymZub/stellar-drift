/**
 * MailClient — client-side private-message unread tracking + send.
 * Communicates over the existing /ws/chat WebSocket, same pattern as GroupSystem/PvpClient.
 *
 * Live delivery/echo of the 'pm' message type itself is still pushed into the chat panel
 * by HudScene (unchanged, pre-existing behavior) — MailClient only tracks unread counts
 * for the mail badge and notifies MailScene of new incoming mail while it's open.
 * Message HISTORY comes from REST (GET /player/pm/history) — see client/src/api.js.
 *
 * The WS reference must already be open. MailClient does NOT own the socket.
 */
export class MailClient {
    constructor(scene, ws) {
        this.scene = scene;
        this.ws = ws;
        this.unreadByUser = {}; // {username: count}

        // Callbacks — assign from HudScene._connectChatWS
        this.onUnreadSummary = null; // (byUser, total) => void
        this.onNewMail       = null; // (msg: {id, from, to, text, time}) => void — incoming only
        this.onError         = null; // (text: string) => void — send failed (blocked/not found/self)
    }

    sendPm(to, text) {
        this._send({ type: 'pm', to, text });
    }

    get totalUnread() {
        return Object.values(this.unreadByUser).reduce((a, b) => a + b, 0);
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'pm_unread_summary':
                this.unreadByUser = msg.by_user || {};
                this.onUnreadSummary?.(this.unreadByUser, msg.total ?? 0);
                break;

            case 'pm':
                if (msg.from !== this.scene.playerName) {
                    this.unreadByUser[msg.from] = (this.unreadByUser[msg.from] || 0) + 1;
                    this.onUnreadSummary?.(this.unreadByUser, this.totalUnread);
                    this.onNewMail?.(msg);
                }
                break;

            case 'pm_error':
                this.onError?.(msg.text);
                break;
        }
    }

    _send(obj) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }
}
