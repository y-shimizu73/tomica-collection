// middleware.js

export const config = {
  // すべてのパスに対してミドルウェアを適用します (staticアセットなどの一部を除く)
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};

// クッキー値を取得する標準Web互換の関数
function getCookie(request, name) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [key, ...valParts] = cookie.split('=');
    const value = valParts.join('=');
    if (key === name) {
      return value;
    }
  }
  return null;
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // 環境変数から認証情報を取得
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;
  
  // 期待されるセッションクッキーのトークン値を生成 (ユーザー名とパスワードのBase64)
  const expectedToken = (expectedUser && expectedPassword) ? btoa(`${expectedUser}:${expectedPassword}`) : null;

  // 1. API ログイン エンドポイント (POST /api/login)
  if (url.pathname === '/api/login' && request.method === 'POST') {
    try {
      const { username, password } = await request.json();

      if (!expectedUser || !expectedPassword) {
        return new Response(JSON.stringify({ error: 'サーバーの認証設定が未完了です。環境変数 BASIC_AUTH_USER / BASIC_AUTH_PASSWORD を設定してください。' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (username === expectedUser && password === expectedPassword) {
        const token = btoa(`${username}:${password}`);
        
        const response = new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
        
        // クッキーをセット (30日間有効, Secure, HttpOnly, SameSite=Strict)
        response.headers.set(
          'Set-Cookie',
          `session_token=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure`
        );
        return response;
      } else {
        return new Response(JSON.stringify({ error: 'ユーザー名またはパスワードが正しくありません。' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'リクエストの処理に失敗しました。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }

  // 2. ログイン画面 (/login.html)
  if (url.pathname === '/login.html') {
    const token = getCookie(request, 'session_token');
    // すでにログイン済みの場合はトップページにリダイレクト
    if (token && token === expectedToken) {
      return Response.redirect(new URL('/', request.url), 307);
    }
    return; // login.htmlの読み込みを許可
  }

  // 3. 認証のチェック
  if (!expectedToken) {
    return new Response('サーバーの認証設定が未完了です。環境変数 BASIC_AUTH_USER / BASIC_AUTH_PASSWORD を設定してください。', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  const token = getCookie(request, 'session_token');

  if (token === expectedToken) {
    // 認証成功！
    
    // Vercel本番環境で、環境変数からFirebase設定を動的生成して返す
    if (url.pathname === '/firebase-config.js') {
      const configJS = `export const firebaseConfig = {
  apiKey: "${process.env.FIREBASE_API_KEY || ''}",
  authDomain: "${process.env.FIREBASE_AUTH_DOMAIN || ''}",
  projectId: "${process.env.FIREBASE_PROJECT_ID || ''}",
  storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET || ''}",
  messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID || ''}",
  appId: "${process.env.FIREBASE_APP_ID || ''}"
};
export const geminiApiKey = "${process.env.GEMINI_API_KEY || ''}";`;
      return new Response(configJS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store, must-revalidate'
        }
      });
    }
    
    return; // 他のコンテンツ（index.html, app.js, index.css等）へのアクセスを通す
  }

  // 4. 未認証の場合はログイン画面へリダイレクト
  return Response.redirect(new URL('/login.html', request.url), 307);
}
