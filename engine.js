const scraper = require('./scraper');
const mongoose = require('mongoose');

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false }, // علامة لتمييز الترجمة الآلية
    createdAt: { type: Date, expires: '15d', default: Date.now } // رفعنا المدة لـ 15 يوم للترجمات النادرة
});

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`[ENGINE] 🧐 فحص المزامنة لـ: ${imdbId} | الملف: ${videoFileName}`);
    
    try {
        // 1. أولاً: فحص هل توجد ترجمة (أصلية أو AI) محفوظة مسبقاً لهذا الفيلم في قاعدتنا؟
        const cachedSubs = await Subtitle.find({ imdbId: imdbId });
        
        if (cachedSubs.length > 0) {
            console.log(`[ENGINE] ✅ وجدنا ${cachedSubs.length} ترجمة محفوظة في القاعدة. يتم العرض الآن...`);
            return cachedSubs.map(sub => ({
                fileId: sub.fileId,
                label: sub.label,
                isMatch: videoFileName.toLowerCase().includes(sub.label.toLowerCase())
            }));
        }

        // 2. ثانياً: إذا لم يوجد شيء في القاعدة، نطلب من السكرابر البحث (عربي أصلي أولاً ثم AI)
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        
        if (!allSubs || allSubs.length === 0) return [];

        let results = [];
        for (let i = 0; i < allSubs.length; i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId}_v${i + 1}_smart`;

            // مطابقة النسخة
            const videoLower = (videoFileName || "").toLowerCase();
            const releaseKeywords = (sub.releaseName || "").toLowerCase().split(/[\s.-]+/);
            const isMatch = videoLower && releaseKeywords.some(kw => 
                kw.length > 3 && videoLower.includes(kw)
            );

            // 3. حفظ النتيجة (سواء كانت أصلية أو مترجمة آلياً) لكي لا نكرر العملية
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName,
                    isAI: sub.source.includes("AI") // تمييزها إذا كانت من محرك الترجمة
                },
                { upsert: true, new: true }
            );
            
            results.push({ fileId, label: sub.releaseName, isMatch });
        }
        
        return results.sort((a, b) => b.isMatch - a.isMatch);
    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ فشل في المحرك: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
