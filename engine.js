const mongoose = require('mongoose');
const scraper = require('./scraper');

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(fullId, videoFileName) {
    let results = [];
    console.log(`[ENGINE] 📥 طلب جديد لـ: ${fullId}`);

    try {
        // 1. الأولوية القصوى: جلب كل ما رفعتَه أنت يدوياً لهذا الـ ID
        const localSubs = await Subtitle.find({ imdbId: fullId }).sort({ createdAt: -1 });
        localSubs.forEach(sub => {
            results.push({
                fileId: sub.fileId,
                label: sub.label,
                isAI: sub.isAI,
                source: "Local"
            });
        });

        // 2. البحث الخارجي (SubDL): يجلب العربي الأصلي أولاً، وإذا لم يجد يعرب نسخة متوافقة
        console.log(`[ENGINE] 🔍 جاري فحص المصادر الخارجية لـ ${fullId}...`);
        const externalSubs = await scraper.fetchAllPossibleSubs(fullId, videoFileName);
        
        for (let sub of externalSubs) {
            // توليد معرف فريد للملف الخارجي
            const newFileId = `${fullId.replace(/:/g, '_')}_ext_${Date.now()}_${Math.floor(Math.random() * 100)}`;
            
            // حفظ في القاعدة لسرعة الاستجابة مستقبلاً
            const savedSub = new Subtitle({
                fileId: newFileId,
                imdbId: fullId,
                arabicText: sub.content,
                label: sub.releaseName || "External Source",
                isAI: sub.source === "AI"
            });

            await savedSub.save();
            
            results.push({
                fileId: savedSub.fileId,
                label: (sub.source === "AI" ? "🤖 AI | " : "🇸🇦 ") + savedSub.label,
                isAI: savedSub.isAI,
                source: "External"
            });
        }

    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ فشل المحرك: ${e.message}`);
    }

    console.log(`[ENGINE] ✅ إجمالي الترجمات المجهزة: ${results.length}`);
    return results;
}

module.exports = { getSyncedSubtitles };
