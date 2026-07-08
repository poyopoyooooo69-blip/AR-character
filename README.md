# ポコのARひろば

QRコードからスマホで開き、カメラ上に3Dキャラクターを表示するWebAR試作です。

## できること

- Android ChromeのWebXR対応端末では、床・机を検出して好きな場所にキャラクターを配置
- WebXR非対応端末では、カメラ映像にキャラクターを重ねる簡易ARへ自動切り替え
- キャラクターは待機中も呼吸、首振り、しっぽなどの決まった動きを実行
- キャラクターをタップするたび、ジャンプ → 回転 → 手を振る、の順にアクション
- 効果音のオン・オフ
- `qr.html` で公開URLの印刷用QRコードを作成

## 公開方法

カメラと本格ARの利用には **HTTPSでの公開** が必要です。

1. `ar-character` フォルダを静的ホスティングへアップロードします。
2. 公開された `https://.../ar-character/` をスマホで開きます。
3. `https://.../ar-character/qr.html` をPCで開き、公開URLを入力します。
4. 作成されたQRコードを印刷または画面表示して使用します。

Netlify Drop、Cloudflare Pages、GitHub Pagesなど、静的ファイルをHTTPS配信できるサービスで公開できます。

## ローカル確認

PCで見た目とタップ反応を確認する場合は、このフォルダでWebサーバーを起動します。

```powershell
python -m http.server 4173
```

その後、ブラウザで `http://localhost:4173/` を開きます。PCでは3Dプレビューまたはカメラ合成モードになります。

## 差し替えポイント

- キャラクターの色・形: `app.js` の `createCharacter()`
- タップ時の動き: `app.js` の `triggerAction()` と `animateCharacter()`
- セリフ: `app.js` の `messages`
- 画面デザイン: `styles.css`

現在のキャラクターはコードで作った軽量なオリジナルです。GLB形式の専用3Dモデルがあれば、同じ操作仕様のまま差し替えできます。
