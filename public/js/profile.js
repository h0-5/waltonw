// Profile Page JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Tab switching
  document.querySelectorAll('.prof-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.getAttribute('data-tab');
      document.querySelectorAll('.prof-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.prof-panel').forEach(function(p) { p.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('panel-' + target).classList.add('active');
    });
  });

  // Log sub-tabs
  document.querySelectorAll('.log-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.getAttribute('data-log');
      document.querySelectorAll('.log-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.log-content').forEach(function(c) { c.style.display = 'none'; });
      this.classList.add('active');
      document.getElementById('log-' + target).style.display = 'block';
    });
  });
});

// Modal
function openModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Send Warning
async function sendWarning(userId) {
  var reason = document.getElementById('warnReason').value.trim();
  var severity = document.getElementById('warnSeverity').value;
  if (!reason) return alert('اكتب سبب التحذير');
  var res = await fetch('/api/admin/profile/warnings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, reason: reason, severity: severity })
  });
  var data = await res.json();
  if (data.success) location.reload();
  else alert(data.error || 'خطأ');
}

// Delete Warning
async function deleteWarning(id) {
  if (!confirm('هل أنت متأكد من حذف التحذير؟')) return;
  var res = await fetch('/api/admin/profile/warnings/' + id, { method: 'DELETE' });
  var data = await res.json();
  if (data.success) location.reload();
  else alert(data.error || 'خطأ');
}

// Submit Excuse
async function submitExcuse(userId) {
  var reason = document.getElementById('excuseReason').value.trim();
  var startDate = document.getElementById('excuseStart').value;
  var endDate = document.getElementById('excuseEnd').value;
  if (!reason || !startDate || !endDate) return alert('املأ كل الحقول');
  var res = await fetch('/api/admin/profile/excuses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, reason: reason, start_date: startDate, end_date: endDate })
  });
  var data = await res.json();
  if (data.success) location.reload();
  else alert(data.error || 'خطأ');
}

// Review Excuse
async function reviewExcuse(id, status) {
  var note = prompt('ملاحظة (اختياري):') || '';
  var res = await fetch('/api/admin/profile/excuses/' + id + '/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status, reviewer_note: note })
  });
  var data = await res.json();
  if (data.success) location.reload();
  else alert(data.error || 'خطأ');
}
