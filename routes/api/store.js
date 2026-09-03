const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Buy product
router.post('/buy', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });

  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'معرف المنتج مفقود' });

  try {
    const [products] = await db.execute('SELECT * FROM fs_products WHERE id = ?', [product_id]);
    if (products.length === 0) return res.status(404).json({ error: 'المنتج غير موجود' });

    const product = products[0];
    if (product.stock <= 0) return res.status(400).json({ error: 'المنتج نفذ من المخزون' });

    // Check user points
    const [points] = await db.execute('SELECT points FROM bot_points WHERE discord_id = ?', [req.user.discord_id]);
    const userPoints = points.length > 0 ? points[0].points : 0;

    if (product.price_points && userPoints < product.price_points) {
      return res.status(400).json({ error: 'نقاطك غير كافية' });
    }

    // Deduct points
    if (product.price_points) {
      await db.execute(
        'UPDATE bot_points SET points = points - ? WHERE discord_id = ?',
        [product.price_points, req.user.discord_id]
      );
    }

    // Decrease stock
    await db.execute('UPDATE fs_products SET stock = stock - 1 WHERE id = ?', [product_id]);

    res.json({ success: true, message: 'تم الشراء بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ أثناء الشراء' });
  }
});

module.exports = router;
