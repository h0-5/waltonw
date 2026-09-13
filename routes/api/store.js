const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Buy product
router.post('/buy', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });
  /* أمن — المحظور ما يشتري: فحص req.user وحده كان يسمح للمحظور بصرف نقاطه */
  if (req.user.is_banned) return res.status(403).json({ error: 'حسابك محظور' });

  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'معرف المنتج مفقود' });

  try {
    const [products] = await db.execute('SELECT * FROM fs_products WHERE id = ?', [product_id]);
    if (products.length === 0) return res.status(404).json({ error: 'المنتج غير موجود' });

    const product = products[0];
    if (product.stock <= 0) return res.status(400).json({ error: 'المنتج نفذ من المخزون' });

    /* شراء ذري — كان فيه سباق: قراءة النقاط/المخزون ثم خصم بدون شرط،
       طلبان متزامنان يدفعان النقاط/المخزون سالب. الحين كل خصم بشرط داخل SQL
       (points >= السعر / stock > 0) فما يعدي الوضع أبداً */
    if (product.price_points && product.price_points > 0) {
      const [deduct] = await db.execute(
        'UPDATE bot_points SET points = points - ? WHERE discord_id = ? AND points >= ?',
        [product.price_points, req.user.discord_id, product.price_points]
      );
      if (!deduct.affectedRows) {
        return res.status(400).json({ error: 'نقاطك غير كافية' });
      }
    }

    {
      const [dec] = await db.execute(
        'UPDATE fs_products SET stock = stock - 1 WHERE id = ? AND stock > 0',
        [product_id]
      );
      if (!dec.affectedRows) {
        // المخزون نفذ بين القراءة والخصم — نرجع النقاط المسحوبة
        if (product.price_points && product.price_points > 0) {
          await db.execute('UPDATE bot_points SET points = points + ? WHERE discord_id = ?', [product.price_points, req.user.discord_id]).catch(() => {});
        }
        return res.status(400).json({ error: 'المنتج نفذ من المخزون' });
      }
    }

    res.json({ success: true, message: 'تم الشراء بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ أثناء الشراء' });
  }
});

module.exports = router;
