const scraper = require('./scraper');
const mongoose = require('mongoose');

// تعريف الموديل لضمان استخدامه للحفظ
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', new mongoose.Schema({
    imdbId: String,
    arabicText: String,
    source: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
}));

async function getSyncedSubtitles(imdbId) {
    try {
        console.log(`[ENGINE] جاري معالجة الطلب لـ: ${imdbId}`);

        // 1. البحث في الكاش أولاً لتوفير الوقت
        const cached = await Subtitle.findOne({ imdbId });
        if (cached) {
            console.log(`[CACHE] تم العثور على الترجمة في القاعدة.`);
            return { source: cached.source };
        }

        // 2. إذا لم تكن موجودة، نجلبها من السكرابر
        const subData = await scraper.fetchSubs(imdbId);

        if (subData && subData.araRaw) {
            // 3. --- الخطوة الأهم: الحفظ في المونجو ---
            const newSub = new Subtitle({
                imdbId: imdbId,
                arabicText: subData.araRaw,
                source: subData.source
            });
            await newSub.save();
            
            console.log(`[DB] تم حفظ الترجمة بنجاح في MongoDB.`);
            return { source: subData.source };
        }
    } catch (e) {
        console.error(`[ENGINE-ERROR] ${e.message}`);
    }
    return null;
}

module.exports = { getSyncedSubtitles };
