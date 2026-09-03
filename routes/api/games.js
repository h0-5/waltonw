const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Create room
router.post('/room/create', async (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  res.json({ roomCode });
});

// Game actions
router.post('/action', async (req, res) => {
  const { game, action, roomId, data } = req.body;
  res.json({ success: true, game, action });
});

module.exports = router;
