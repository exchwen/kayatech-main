Doky
# Kayatech3D Teklif

STL dosyalarından gerçek dilimleme verileriyle 3D baskı teklifi hazırlamak için Next.js uygulaması.

## Özellikler

- STL dosyası yükleme
- Sunucu üzerinden dilimleme API'sine erişim
- Filament tüketimi ve tahmini baskı süresini gösterme
- Mobil uyumlu arayüz

## Yerel geliştirme

```bash
npm install
npm run dev
```

## Vercel ortam değişkenleri

- `SLICER_SERVICE_URL`: Google Cloud Run servis adresi.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Cloud Run servisini çağırmaya yetkili servis hesabının JSON içeriği.

Bu değerleri Vercel'in sunucu ortam değişkenlerinde saklayın. Gizli anahtarları GitHub deposuna eklemeyin.

## Not

Bu sürüm dilimleme sonuçlarını gösterir. Otomatik fiyatlandırma, ödeme ve sipariş sistemi henüz tamamlanmamıştır.
