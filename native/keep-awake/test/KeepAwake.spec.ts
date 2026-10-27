import {KeepAwake} from '../src';

jest.mock('../src/turbo-modules/KeepAwake');

describe('KeepAwake', () => {
  it('starts and stops', () => {
    expect(KeepAwake.start()).toBe('');
    expect(KeepAwake.stop()).toBe('');
  });
});
