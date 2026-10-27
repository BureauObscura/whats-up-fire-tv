import {WebView} from '@amazon-devices/webview';
import * as React from 'react';
import {useCallback, useEffect, useRef} from 'react';
import {AppState, BackHandler, View, StyleSheet} from 'react-native';
import {KeepAwake} from '@whatsup/keep-awake';
import {
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import {
  WebViewErrorEvent,
  WebViewMessageEvent,
} from '@amazon-devices/webview/dist/types/WebViewTypes';

// The page (assets/, built from web/) asks the app to fetch for it: adsb.fi
// sends no CORS header, so the WebView cannot read it directly. The other
// services do send CORS headers; they are allowed here as a fallback. Only
// these read-only GETs are reachable through the bridge.
const ALLOWED = [
  /^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/-?\d{1,2}\.\d{2}\/lon\/-?\d{1,3}\.\d{2}\/dist\/\d{1,3}$/,
  /^https:\/\/vrs-standing-data\.adsb\.lol\/routes\/[A-Z0-9-]{2}\/[A-Z0-9-]{2,10}\.json$/,
  /^https:\/\/get\.geojs\.io\/v1\/ip\/geo\.json$/,
  /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=[^&#]{1,200}&count=\d{1,2}&language=en&format=json$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet$/,
  /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?address=[^&#]{1,300}&benchmark=Public_AR_Current&format=json$/,
  /^https:\/\/nominatim\.openstreetmap\.org\/search\?q=[^&#]{1,300}&format=jsonv2&limit=5&addressdetails=1$/,
  /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=-?\d{1,2}\.\d{2}&longitude=-?\d{1,3}\.\d{2}&timezone=auto&forecast_days=1$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\d{1,2}\/\d{1,6}\/\d{1,6}\.pbf$/,
];
const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'WhatsUp/0.1 (Fire TV aircraft radar app, Vega OS)';

type Request = {
  type: 'get' | 'ui';
  id: number;
  url: string;
  timeoutMs?: number;
  binary?: boolean;
  overlay?: boolean;
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

async function get(
  url: string,
  timeoutMs: number,
  binary: boolean,
): Promise<[number | string, string]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: binary ? '*/*' : 'application/json',
      },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      return [response.status, ''];
    }
    if (binary) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > MAX_BYTES
        ? ['oversize', '']
        : [200, base64(bytes)];
    }
    const text = await response.text();
    return text.length > MAX_BYTES ? ['oversize', ''] : [200, text];
  } catch {
    return ['connection_error', ''];
  } finally {
    clearTimeout(timer);
  }
}

// While the app is on screen it is a display people glance at, not a menu: tell
// Vega the user is engaged (User Engagement API, via native/keep-awake) so the
// screensaver stays away, and give that up as soon as the app leaves the screen.
function engage(on: boolean) {
  try {
    const error = on ? KeepAwake.start() : KeepAwake.stop();
    if (error) {
      console.error(`[keep-awake] ${on ? 'start' : 'stop'}: ${error}`);
    }
  } catch (e) {
    console.error(`[keep-awake] ${String(e)}`);
  }
}

export const App = () => {
  const webRef = useRef<any>(null);
  // True while the page shows Settings or the location screen: Back closes it.
  const overlayRef = useRef(false);
  // Keep the splash screen up until the page has loaded.
  usePreventHideSplashScreen();
  const hideSplashScreenCallback = useHideSplashScreenCallback();

  useEffect(() => {
    engage(AppState.currentState !== 'background');
    const sub = AppState.addEventListener('change', state =>
      engage(state === 'active'),
    );
    return () => {
      sub.remove();
      engage(false);
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!overlayRef.current) {
        return false;
      }
      webRef.current?.injectJavaScript(
        'window.__whatsupBack&&window.__whatsupBack();true;',
      );
      return true;
    });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let request: Request;
    try {
      request = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (request?.type === 'ui') {
      overlayRef.current = request.overlay === true;
      return;
    }
    if (
      request?.type !== 'get' ||
      !Number.isInteger(request.id) ||
      typeof request.url !== 'string'
    ) {
      return;
    }
    // Answer a refused URL at once, so the page never waits out its timeout.
    if (!ALLOWED.some(pattern => pattern.test(request.url))) {
      console.error(`[bridge] refused ${request.url.slice(0, 120)}`);
      webRef.current?.injectJavaScript(
        `window.__whatsupReply&&window.__whatsupReply(${request.id},"blocked","");true;`,
      );
      return;
    }
    const timeoutMs = Math.min(
      12000,
      Math.max(1000, Number(request.timeoutMs) || 8000),
    );
    get(request.url, timeoutMs, request.binary === true).then(
      ([status, text]) => {
        webRef.current?.injectJavaScript(
          `window.__whatsupReply&&window.__whatsupReply(${
            request.id
          },${JSON.stringify(status)},${JSON.stringify(text)});true;`,
        );
      },
    );
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        style={styles.webview}
        domStorageEnabled
        hasTVPreferredFocus
        javaScriptEnabled
        mixedContentMode="never"
        source={{uri: 'file:///pkg/assets/index.html'}}
        onMessage={onMessage}
        onLoad={() => hideSplashScreenCallback()}
        onError={({
          nativeEvent: {code, url, description},
        }: WebViewErrorEvent) => {
          console.error(`[onError]: (${code}: ${url}) ${description}`);
          hideSplashScreenCallback();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000'},
  webview: {backgroundColor: '#000'},
});
