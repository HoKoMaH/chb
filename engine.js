const scraper = require('./scraper');
const mongoose = require('mongoose');

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(imdbId) {
    console.log(`[ENGINE] بدأت عملية البحث لـ: ${imdbId}`);
    try {
        // فحص السكرابر
        console.log(`[ENGINE] استدعاء السكرابر...`);
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        
        if (!allSubs || allSubs.length === 0) {
            console.log(`[ENGINE] ⚠️ السكرابر لم يجد أي نتائج.`);
            return [];
        }

        console.log(`[ENGINE] تم العثور على ${allSubs.length} نسخة من السكرابر.`);
        
        let results = [];
        for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId}_v${i + 1}`;

            // حفظ في القاعدة
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName || `Option ${i + 1}` 
                },
                { upsert: true, new: true }
            );
            
            results.push({ fileId: fileId, label: sub.releaseName || `Option ${i + 1}` });
        }
        
        console.log(`[ENGINE] ✅ تمت معالجة وحفظ ${results.length} نتائج.`);
        return results;
    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ خطأ داخلي: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
