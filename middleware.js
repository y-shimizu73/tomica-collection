// middleware.js

export const config = {
  // すべてのパスに対してBasic認証を適用します
  matcher: '/(.*)',
};

export default function middleware(request) {
  const url = new URL(request.url);

  // Vercel本番環境で、環境変数からFirebase設定を動的生成して返す
  if (url.pathname === '/firebase-config.js') {
    const configJS = `export const firebaseConfig = {
  apiKey: "${process.env.FIREBASE_API_KEY || ''}",
  authDomain: "${process.env.FIREBASE_AUTH_DOMAIN || ''}",
  projectId: "${process.env.FIREBASE_PROJECT_ID || ''}",
  storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET || ''}",
  messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID || ''}",
  appId: "${process.env.FIREBASE_APP_ID || ''}"
};`;
    return new Response(configJS, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate'
      }
    });
  }

  const authorizationHeader = request.headers.get('authorization');

  if (authorizationHeader) {
    const basicAuth = authorizationHeader.split(' ')[1];
    try {
      const decoded = atob(basicAuth);
      const [user, password] = decoded.split(':');

      // Vercelの環境変数からユーザー名とパスワードを取得
      const expectedUser = process.env.BASIC_AUTH_USER;
      const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

      // 環境変数が設定されていない場合は、セキュリティのためエラーとする
      if (!expectedUser || !expectedPassword) {
        return new Response('サーバーの認証設定が未完了です。', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }

      if (user === expectedUser && password === expectedPassword) {
        // レスポンスを返さずに終了することで、リクエストを元の静的コンテンツへパススルーします
        return;
      }
    } catch (e) {
      console.error('Base64デコードに失敗しました:', e);
    }
  }

  // 認証ヘッダーがない、または認証に失敗した場合は401を返してブラウザの認証ダイアログを表示させます
  return new Response('認証が必要です。', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
      'Content-Type': 'text/plain; charset=utf-8'
    },
  });
}
