// รายชื่อบริษัท/แบรนด์ อ่านจากไฟล์กลาง /dms/brands.js (ใช้ร่วมกับเว็บหลังบ้าน — แก้ที่ไฟล์นั้นที่เดียว)
// เซลล์ไม่ต้องใส่ลิงก์เอง: ตอนเข้าระบบ แอปจะหาให้เองว่า User นี้อยู่แบรนด์ไหน แล้วเข้าระบบของแบรนด์นั้นเท่านั้น
// รายชื่อด้านล่างใช้สำรอง กรณีโหลดไฟล์กลางไม่ได้
window.DMS_BRANDS = window.DMS_BRANDS || [
  { name: 'KHAOSHONG', url: 'https://script.google.com/macros/s/AKfycbwAwmuzSxdFn0OoS0d3EnDb3pZQ5BAVE-lLuE6cbdbNKTDjnBaPsWxupTyX7vS68EmfUA/exec' }
];
window.DMS_URL = '';   // (แบบเก่า) ใช้เฉพาะกรณีไม่มีรายชื่อด้านบน
