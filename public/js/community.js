// ==========================================
// COMMUNITY CHAT JAVASCRIPT
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  const chatMessages = document.getElementById('chatMessages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const onlineUsers = document.getElementById('onlineUsers');
  const onlineCount = document.getElementById('onlineCount');

  let lastMessageId = 0;
  let isPolling = false;

  // Load messages
  async function loadMessages() {
    if (isPolling) return;
    isPolling = true;
    try {
      const res = await fetch(`/api/community/messages?lastId=${lastMessageId}`);
      const data = await res.json();
      
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
          appendMessage(msg);
          lastMessageId = Math.max(lastMessageId, msg.id);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } catch (e) {
      console.error('Error loading messages:', e);
    } finally {
      isPolling = false;
    }
  }

  // Append message to chat
  function appendMessage(msg) {
    const isOwn = msg.user_id === currentUserId;
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isOwn ? 'own' : ''}`;
    messageEl.innerHTML = `
      <div class="message-avatar">
        <img src="${msg.avatar || '/images/default-avatar.png'}" alt="avatar">
      </div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-author">${escapeHtml(msg.username)}</span>
          <span class="message-time">${formatTime(msg.created_at)}</span>
        </div>
        <div class="message-text">${escapeHtml(msg.message)}</div>
      </div>
    `;
    chatMessages.appendChild(messageEl);
  }

  // Send message
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    try {
      sendBtn.disabled = true;
      const res = await fetch('/api/community/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      
      if (data.success) {
        messageInput.value = '';
        loadMessages();
      } else {
        WaltonAPI.showNotification(data.error || 'فشل الإرسال', 'error');
      }
    } catch (e) {
      WaltonAPI.showNotification('حدث خطأ في الإرسال', 'error');
    } finally {
      sendBtn.disabled = false;
    }
  }

  // Load online users
  async function loadOnlineUsers() {
    try {
      const res = await fetch('/api/community/online');
      const data = await res.json();
      
      if (data.users) {
        onlineCount.textContent = data.users.length;
        onlineUsers.innerHTML = data.users.map(user => `
          <div class="online-user">
            <img src="${user.avatar || '/images/default-avatar.png'}" alt="avatar">
            <span>${escapeHtml(user.username)}</span>
          </div>
        `).join('');
      }
    } catch (e) {
      console.error('Error loading online users:', e);
    }
  }

  // Event listeners
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }

  if (messageInput) {
    messageInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // Helper functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  }

  // Initial load
  loadMessages();
  loadOnlineUsers();

  // Polling — كان كل 3 ثوان (20 طلب/دقيقة لكل تاب مفتوح = استهلاك استضافة مستمر)
  // الآن: 10 ثوان + يتوقف كلياً والتاب مخفي/بالخلفية، ويعيد الجلب فور رجوعك للتاب
  let onlineTimer = setInterval(function() {
    if (!document.hidden) loadOnlineUsers();
  }, 30000);
  let messageTimer = setInterval(function() {
    if (!document.hidden) loadMessages();
  }, 10000);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      loadMessages();
      loadOnlineUsers();
    }
  });
  // تحرير المؤقتات إذا غادرت صفحة المجتمع (تنقل SPA نادر لكن احتياط)
  window.addEventListener('pagehide', function() {
    clearInterval(messageTimer);
    clearInterval(onlineTimer);
  });
});
