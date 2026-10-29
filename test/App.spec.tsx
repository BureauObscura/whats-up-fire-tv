import * as React from 'react';
import {act, render} from '@testing-library/react-native';
import {App} from '../src/App';

jest.mock('@amazon-devices/webview', () => ({
  WebView: 'WebView',
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  usePreventHideSplashScreen: jest.fn(),
  useHideSplashScreenCallback: jest.fn(() => jest.fn()),
  StyleSheet: {create: (styles: unknown) => styles},
  BackHandler: {addEventListener: jest.fn(() => ({remove: jest.fn()}))},
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_type: string, listener: (s: string) => void) => {
      mockAppState.listener = listener;
      return {remove: jest.fn()};
    }),
  },
  View: 'View',
}));
const mockAppState: {listener: (state: string) => void} = {listener: () => {}};

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  KeplerVideoSurfaceView: 'KeplerVideoSurfaceView',
  VideoPlayer: jest.fn(),
}));
jest.mock('../src/chime', () => ({playChime: jest.fn(), releaseChime: jest.fn()}));
jest.mock('../src/silentLoop', () => ({
  setSurface: jest.fn(),
  startLoop: jest.fn(() => Promise.resolve()),
  stopLoop: jest.fn(),
}));
const mockLoop = jest.requireMock('../src/silentLoop');
jest.mock('@whatsup/keep-awake', () => ({
  KeepAwake: {start: jest.fn(() => ''), stop: jest.fn(() => '')},
}));
const mockKeepAwake = jest.requireMock('@whatsup/keep-awake').KeepAwake;

describe('App', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<App />);
    expect(toJSON()).toBeTruthy();
  });

  // The page reports Settings > Keep screen awake through the bridge.
  const sayAwake = (r: ReturnType<typeof render>, on: boolean) =>
    act(() =>
      r.UNSAFE_root.findByType('WebView' as any).props.onMessage({
        nativeEvent: {data: JSON.stringify({type: 'awake', on})},
      }),
    );

  it('holds off the screensaver only while shown AND the switch is on', () => {
    mockKeepAwake.start.mockClear();
    mockKeepAwake.stop.mockClear();
    const r = render(<App />);
    expect(mockKeepAwake.start).not.toHaveBeenCalled(); // off until the page says on
    sayAwake(r, true);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(1);
    act(() => mockAppState.listener('background'));
    expect(mockKeepAwake.stop).toHaveBeenCalledTimes(1);
    act(() => mockAppState.listener('active'));
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    sayAwake(r, false);
    expect(mockKeepAwake.stop).toHaveBeenCalledTimes(2);
    act(() => mockAppState.listener('background'));
    act(() => mockAppState.listener('active'));
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2); // switch off: nothing reported
    r.unmount();
  });

  it('plays the silent loop only while shown and Keep screen awake is on', () => {
    mockLoop.startLoop.mockClear();
    mockLoop.stopLoop.mockClear();
    const r = render(<App />);
    expect(mockLoop.startLoop).not.toHaveBeenCalled();
    sayAwake(r, true);
    expect(mockLoop.startLoop).toHaveBeenCalled();
    act(() => mockAppState.listener('background'));
    expect(mockLoop.stopLoop).toHaveBeenCalled();
    mockLoop.startLoop.mockClear();
    act(() => mockAppState.listener('active'));
    expect(mockLoop.startLoop).toHaveBeenCalled();
    r.unmount();
  });

  it('re-reports engagement every 4 minutes only while active and on', () => {
    jest.useFakeTimers();
    mockKeepAwake.start.mockClear();
    const r = render(<App />);
    jest.advanceTimersByTime(8 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(0);
    sayAwake(r, true);
    jest.advanceTimersByTime(4 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    act(() => mockAppState.listener('background'));
    jest.advanceTimersByTime(8 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    r.unmount();
    jest.useRealTimers();
  });
});
