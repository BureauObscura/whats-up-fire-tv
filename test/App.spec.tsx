import * as React from 'react';
import {render} from '@testing-library/react-native';
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

jest.mock('@whatsup/keep-awake', () => ({
  KeepAwake: {start: jest.fn(() => ''), stop: jest.fn(() => '')},
}));
const mockKeepAwake = jest.requireMock('@whatsup/keep-awake').KeepAwake;

describe('App', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<App />);
    expect(toJSON()).toBeTruthy();
  });

  it('holds off the screensaver while shown and lets go when backgrounded or closed', () => {
    mockKeepAwake.start.mockClear();
    mockKeepAwake.stop.mockClear();
    const {unmount} = render(<App />);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(1);
    mockAppState.listener('background');
    expect(mockKeepAwake.stop).toHaveBeenCalledTimes(1);
    mockAppState.listener('active');
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    unmount();
    expect(mockKeepAwake.stop).toHaveBeenCalledTimes(2);
  });

  it('re-reports engagement every 4 minutes only while active', () => {
    jest.useFakeTimers();
    mockKeepAwake.start.mockClear();
    mockKeepAwake.stop.mockClear();
    const {unmount} = render(<App />);
    jest.advanceTimersByTime(4 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    mockAppState.listener('background');
    jest.advanceTimersByTime(8 * 60 * 1000);
    expect(mockKeepAwake.start).toHaveBeenCalledTimes(2);
    unmount();
    jest.useRealTimers();
  });
});
