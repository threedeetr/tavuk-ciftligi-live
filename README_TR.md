# Tavuk Çiftliği LIVE — Cloud Connector

Bu paket, mevcut HTML çiftliğini Node.js tabanlı bir bulut köprüsüne bağlar.
TikTok LIVE bağlantısı **resmî değildir**. `tiktok-live-connector` adlı açık kaynak Node.js istemcisini kullanır.

## Nasıl çalışır?

TikTok LIVE → Node.js connector → bu sunucudaki WebSocket `/ws` → `public/index.html` → mevcut oyun fonksiyonları.

Tarayıcı tarafında `onChickenGift`, `onFoxGift`, `onBigGift`, `onEggGift` fonksiyonları değiştirilmeden kullanılır. Demo butonları da korunur.

## Cloud deploy (Render örneği)

1. Bu ZIP'i açıp içindeki klasörü kendi GitHub deponuza yükleyin.
2. Render'da **New + → Blueprint** ile depoyu seçin (`render.yaml` algılanır).
3. Servisin Environment bölümünde `TIKTOK_USERNAME` değerini kendi TikTok kullanıcı adınızla, başında `@` olmadan girin.
4. Deploy tamamlanınca verilen `https://...onrender.com` adresini telefondaki Chrome'da açın.
5. TikTok hesabınız LIVE yayındayken `/health` sayfasından `tiktokConnected: true` olduğunu kontrol edin.

Bu Blueprint başlangıçta ücretsiz planı seçer; ücretsiz servisler boşta kaldığında uykuya geçebilir ve bağlantıyı kesebilir. Yayın boyunca kesintisiz çalışması için Render panelinden uyumayan ücretli bir web service planı seçin. Ücretli plana geçiş ücret doğurur; bunu senin onayın olmadan yapmıyorum.

## Hediye eşleştirmesi

Environment Variables:
- `CHICKEN_GIFTS`: tavuk oluşturacak hediye adları (virgülle ayrılmış)
- `FOX_GIFTS`: tilki saldırısı başlatacak hediye adları
- `EGG_GIFTS`: yumurta oluşturacak hediye adları
- `BIG_GIFT_MIN`: bu eşiğe ulaşan tek hediye olayı çiftlik sahipliği yarışına girer

İsimler örnektir; LIVE odasının hediye kataloğunda gelen gerçek isimlerle eşleşmelidir. `enableExtendedGiftInfo` açık olduğunda hediye adı ve elmas değeri alınmaya çalışılır. Eşleşmeyen hediyeler loglanır ama oyuna gönderilmez.

Tek hediyenin puanı `diamondCount × repeatCount` olarak hesaplanır. İzleyicinin yayın boyunca toplam harcaması tutulmaz. Streak hediyelerinde ara güncellemeler atlanır, bitiş olayı bir kez işlenir.

## Yerel kontrol

Node.js 20+ gerekir:
```bash
cp .env.example .env
# .env içindeki TIKTOK_USERNAME değerini düzenle
npm install
npm start
```
Ardından `http://localhost:3000` açılır. Telefonla yerel testte telefon ve bilgisayar aynı Wi-Fi'da olmalı; bulut kullanımı için deploy gerekir.

## Güvenlik ve sınırlamalar

- TikTok şifresi, oturum çerezi veya kişisel giriş bilgisi istenmez. Sunucuya bunları eklemeyin.
- WebSocket yalnızca sunucunun normalize ettiği hediye olaylarını tarayıcıya yayınlar; tarayıcıdan oyun olayı enjekte eden yönetim endpoint'i yoktur.
- Connector, TikTok'un dahili Webcast protokolünü tersine mühendislikle okur. TikTok protokolü veya üçüncü taraf imzalama servisi değişirse çalışması bozulabilir.
- Bu paket LIVE bağlantısını ancak buluta deploy edilip `TIKTOK_USERNAME` ayarlandıktan ve yayın LIVE olduktan sonra kurar. Bu sohbet ortamından senin TikTok hesabına veya Render hesabına deploy yapılamaz.
- Bağlantı kesilince tek bir döngü üzerinden artan bekleme süresiyle otomatik yeniden bağlanır.
- Hediye adları/puanları bölgeye, dile ve katalogya göre değişebilir. İlk yayın öncesi sunucu loglarını kontrol ederek eşleştirmeleri doğrulayın.

## Kaynaklar

- TikTok LIVE Connector: https://www.npmjs.com/package/tiktok-live-connector
- Dokümantasyon: https://ttlc.docs.isaackogan.com/
- Bağlantı yaşam döngüsü: https://ttlc.docs.isaackogan.com/getting-started/connection/
