/**
 * صفحة الإحصائيات واستعراض الترجمات (Advanced Dashboard)
 * الرابط: https://chb-gy3n.onrender.com/stats
 */
app.get("/stats", async (req, res) => {
    try {
        // جلب آخر 50 ترجمة تم تخزينها
        const subs = await Subtitle.find().sort({ createdAt: -1 }).limit(50);
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });

        let tableRows = subs.map(sub => `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 12px; text-align: right;">${sub.label}</td>
                <td style="padding: 12px;">${sub.isAI ? '🤖 ذكاء اصطناعي' : '🇸🇦 أصلية'}</td>
                <td style="padding: 12px;">${new Date(sub.createdAt).toLocaleDateString('ar-SA')}</td>
                <td style="padding: 12px;">
                    <a href="/sub/${sub.fileId}.srt" download="${sub.label}.srt" 
                       style="background: #3498db; color: white; padding: 5px 15px; border-radius: 5px; text-decoration: none; font-size: 12px;">
                       تحميل ↓
                    </a>
                </td>
            </tr>
        `).join('');

        const html = `
        <div style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #f8f9fa; min-height: 100vh; padding: 40px; direction: rtl;">
            <div style="max-width: 1000px; margin: auto;">
                <h1 style="text-align: center; color: #2c3e50;">📊 لوحة تحكم AR.SA الذكية</h1>
                
                <div style="display: flex; justify-content: center; gap: 20px; margin-bottom: 40px;">
                    <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); flex: 1; text-align: center;">
                        <h4 style="margin: 0; color: #7f8c8d;">إجمالي الملفات</h4>
                        <p style="font-size: 24px; font-weight: bold; color: #3498db;">${totalSubs}</p>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); flex: 1; text-align: center;">
                        <h4 style="margin: 0; color: #7f8c8d;">ترجمة AI 🤖</h4>
                        <p style="font-size: 24px; font-weight: bold; color: #2ecc71;">${aiSubs}</p>
                    </div>
                </div>

                <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                    <h3 style="margin-top: 0; border-bottom: 2px solid #eee; padding-bottom: 10px;">آخر الملفات المضافة</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f1f1f1;">
                                <th style="padding: 12px; text-align: right;">اسم الملف / النسخة</th>
                                <th style="padding: 12px; text-align: right;">النوع</th>
                                <th style="padding: 12px; text-align: right;">التاريخ</th>
                                <th style="padding: 12px; text-align: right;">التحكم</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                    ${subs.length === 0 ? '<p style="text-align:center; padding: 20px;">لا توجد ترجمات مخزنة بعد.</p>' : ''}
                </div>
                
                <p style="text-align: center; margin-top: 30px; color: #bdc3c7; font-size: 14px;">تحديث تلقائي عند كل طلب جديد 🟢</p>
            </div>
        </div>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        console.error(e);
        res.status(500).send("خطأ في تحميل لوحة التحكم");
    }
});
