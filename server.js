require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Khởi tạo SQLite Database
const dbPath = path.join(__dirname, 'ninja_database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("❌ Lỗi kết nối SQLite:", err.message);
    } else {
        console.log("⚡ Đã kết nối Database SQLite thành công: ninja_database.sqlite");
    }
});

// Tạo bảng Users & OTP Codes
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'Shinobi',
            rank TEXT DEFAULT 'Genin',
            village TEXT DEFAULT 'Nhẫn giả tự do',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tự động kiểm tra và thêm cột nếu bảng đã tồn tại từ trước
    db.run("ALTER TABLE users ADD COLUMN rank TEXT DEFAULT 'Genin'", () => {});
    db.run("ALTER TABLE users ADD COLUMN village TEXT DEFAULT 'Nhẫn giả tự do'", () => {});

    db.run(`
        CREATE TABLE IF NOT EXISTS password_resets (
            email TEXT PRIMARY KEY,
            otp TEXT NOT NULL,
            expires_at DATETIME NOT NULL
        )
    `);

    // Thêm tài khoản mẫu nếu chưa có
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (!err && row.count === 0) {
            const stmt = db.prepare("INSERT INTO users (name, email, password, role, rank, village) VALUES (?, ?, ?, ?, ?, ?)");
            stmt.run("Itachi Uchiha", "itachi@uchiha.com", "tsukuyomi123", "Akatsuki Master", "Jonin", "Tổ Chức Akatsuki");
            stmt.run("Obito Uchiha", "obito@uchiha.com", "kamui123", "Leader of Eye of the Moon", "Kage", "Tổ Chức Akatsuki");
            stmt.finalize();
            console.log("🌟 Đã khởi tạo 2 tài khoản Ninja mẫu trong Database!");
        }
    });
});

// Cấu hình Transporter gửi Email
function getTransporter() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass || user === 'your_email@gmail.com') {
        return null; // Chưa cấu hình Gmail thật
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
    });
}

// ---------------- API ENDPOINTS ----------------

// 1. API Đăng Ký
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập đầy đủ thông tin!" });
    }

    const cleanEmail = email.trim().toLowerCase();

    db.get("SELECT id FROM users WHERE LOWER(email) = ?", [cleanEmail], (err, user) => {
        if (err) return res.status(500).json({ success: false, message: "Lỗi cơ sở dữ liệu!" });
        if (user) {
            return res.status(400).json({ success: false, message: "Email Ninja này đã tồn tại trong gia tộc!" });
        }

        const insert = db.prepare("INSERT INTO users (name, email, password) VALUES (?, ?, ?)");
        insert.run(name.trim(), cleanEmail, password, function (insertErr) {
            if (insertErr) return res.status(500).json({ success: false, message: "Không thể đăng ký tài khoản!" });
            return res.json({
                success: true,
                message: `Kích hoạt ấn ký thành công cho ${name}!`,
                user: { id: this.lastID, name, email: cleanEmail }
            });
        });
        insert.finalize();
    });
});

// 2. API Đăng Nhập
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập email và mật khẩu!" });
    }

    const cleanEmail = email.trim().toLowerCase();

    db.get(
        "SELECT id, name, email, role, rank, village, password FROM users WHERE LOWER(email) = ? OR LOWER(name) = ?",
        [cleanEmail, cleanEmail],
        (err, user) => {
            if (err) return res.status(500).json({ success: false, message: "Lỗi cơ sở dữ liệu!" });
            if (!user || user.password !== password) {
                return res.status(401).json({ success: false, message: "Chakra hoặc mật khẩu ấn chú không chính xác!" });
            }

            return res.json({
                success: true,
                message: `Khai mở nhẫn thuật thành công! Chào mừng ${user.name}.`,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role || 'Shinobi',
                    rank: user.rank || 'Genin',
                    village: user.village || 'Nhẫn giả tự do'
                }
            });
        }
    );
});

// 2.1 API Cập nhật Gia Nhập Làng
app.post('/api/select-village', (req, res) => {
    const { email, village } = req.body;
    if (!email || !village) {
        return res.status(400).json({ success: false, message: "Thiếu thông tin ninja hoặc làng!" });
    }

    const cleanEmail = email.trim().toLowerCase();
    db.run("UPDATE users SET village = ? WHERE LOWER(email) = ?", [village, cleanEmail], function (err) {
        if (err) return res.status(500).json({ success: false, message: "Lỗi cập nhật làng!" });
        return res.json({
            success: true,
            message: `Chúc mừng bạn đã chính thức trở thành Nhẫn giả của ${village}!`,
            village: village
        });
    });
});

// 3. API Quên Mật Khẩu (Gửi mã OTP về Gmail)
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: "Vui lòng cung cấp Email nhận mã!" });
    }

    const cleanEmail = email.trim().toLowerCase();

    db.get("SELECT id, name, password FROM users WHERE LOWER(email) = ?", [cleanEmail], async (err, user) => {
        if (err) return res.status(500).json({ success: false, message: "Lỗi máy chủ!" });
        if (!user) {
            return res.status(404).json({ success: false, message: "Không tìm thấy nhẫn giả nào sở hữu email này!" });
        }

        // Tạo mã OTP 6 chữ số ngẫu nhiên
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // Có hiệu lực 15 phút

        db.run(
            "INSERT OR REPLACE INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?)",
            [cleanEmail, otp, expiresAt],
            async (dbErr) => {
                if (dbErr) return res.status(500).json({ success: false, message: "Không thể tạo mã OTP!" });

                const transporter = getTransporter();

                // Trường hợp người dùng chưa cấu hình Gmail thật trong .env
                if (!transporter) {
                    console.log(`\n========================================`);
                    console.log(`🔔 [MOCK GMAIL OTP SENDER]`);
                    console.log(`📧 Gửi tới: ${cleanEmail} (${user.name})`);
                    console.log(`🔑 Mã OTP Khôi Phục: ${otp}`);
                    console.log(`🔒 Mật khẩu hiện tại: ${user.password}`);
                    console.log(`========================================\n`);

                    return res.json({
                        success: true,
                        mockMode: true,
                        otp: otp, // Trả về cho frontend hỗ trợ test ngay khi chưa có Gmail SMTP
                        message: `Đã phát lệnh gửi mã OTP về Gmail ${cleanEmail}!`
                    });
                }

                // Gửi Email thật qua Google SMTP
                const mailOptions = {
                    from: `"Hội Đồng Gia Tộc Uchiha" <${process.env.EMAIL_USER}>`,
                    to: cleanEmail,
                    subject: `[UCHIHA PORTAL] Mã Khôi Phục Ấn Chú Mật Khẩu: ${otp}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; background: #0c0a14; color: #fff; padding: 25px; border-radius: 12px; border: 1px solid #ff1e42; max-width: 500px; margin: auto;">
                            <h2 style="color: #ff3355; text-align: center; letter-spacing: 2px;">GIA TỘC UCHIHA - KẾ HOẠCH NGUYỆT NHÃN</h2>
                            <p>Xin chào <strong>${user.name}</strong>,</p>
                            <p>Bạn vừa yêu cầu khôi phục mật khẩu ấn chú trên Cổng Nhẫn Giả Uchiha Legacy.</p>
                            <div style="text-align: center; margin: 25px 0;">
                                <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #ff1e42; background: rgba(255,30,66,0.15); padding: 10px 24px; border-radius: 8px; border: 1px dashed #ff1e42;">${otp}</span>
                            </div>
                            <p style="font-size: 13px; color: #aaa;">Mã OTP này có hiệu lực trong vòng <strong>15 phút</strong>. Tuyệt đối không chia sẻ mã này cho bất kỳ ninja làng khác.</p>
                            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;">
                            <p style="font-size: 12px; color: #777; text-align: center;">Uchiha Legacy System &bull; Tsukuyomi Vô Hạn</p>
                        </div>
                    `
                };

                try {
                    await transporter.sendMail(mailOptions);
                    return res.json({
                        success: true,
                        mockMode: false,
                        message: `Mã OTP khôi phục đã được gửi thẳng về hòm thư Gmail ${cleanEmail}!`
                    });
                } catch (sendErr) {
                    console.error("❌ Lỗi gửi Gmail:", sendErr);
                    return res.status(500).json({
                        success: false,
                        message: "Lỗi kết nối máy chủ gửi Gmail. Vui lòng kiểm tra lại cấu hình App Password!"
                    });
                }
            }
        );
    });
});

// 4. API Đặt Lại Mật Khẩu Bằng Mã OTP
app.post('/api/reset-password', (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        return res.status(400).json({ success: false, message: "Vui lòng điền đủ email, mã OTP và mật khẩu mới!" });
    }

    const cleanEmail = email.trim().toLowerCase();

    db.get("SELECT otp, expires_at FROM password_resets WHERE email = ?", [cleanEmail], (err, record) => {
        if (err) return res.status(500).json({ success: false, message: "Lỗi kiểm tra mã OTP!" });
        if (!record || record.otp !== otp.trim()) {
            return res.status(400).json({ success: false, message: "Mã OTP không chính xác!" });
        }

        if (new Date() > new Date(record.expires_at)) {
            return res.status(400).json({ success: false, message: "Mã OTP đã hết hạn (quá 15 phút)!" });
        }

        // Cập nhật mật khẩu mới vào bảng Users
        db.run("UPDATE users SET password = ? WHERE LOWER(email) = ?", [newPassword, cleanEmail], (updateErr) => {
            if (updateErr) return res.status(500).json({ success: false, message: "Không thể cập nhật mật khẩu!" });

            // Xóa OTP đã sử dụng
            db.run("DELETE FROM password_resets WHERE email = ?", [cleanEmail]);

            return res.json({
                success: true,
                message: "Thiết lập mật khẩu mới thành công! Bạn có thể đăng nhập ngay."
            });
        });
    });
});

// Khởi chạy server
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 UCHIHA BACKEND SERVER ĐANG CHẠY TẠI:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`👉 Cổng Đăng Nhập: http://localhost:${PORT}/login.html`);
    console.log(`👉 Trang Chủ: http://localhost:${PORT}/index.html`);
    console.log(`=================================================`);
});
