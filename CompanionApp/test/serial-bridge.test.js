import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeOpenError } from '../src/serial-bridge.js';

describe('describeOpenError', () => {
  it('adds the udev fix for a Linux permission error', () => {
    const msg = describeOpenError('/dev/ttyACM0', new Error('Opening /dev/ttyACM0: Permission denied'), 'linux').message;
    assert.match(msg, /^Failed to open \/dev\/ttyACM0: /);
    assert.match(msg, /ATTRS\{idVendor\}=="0483", ATTRS\{idProduct\}=="5740"/);
    assert.match(msg, /TAG\+="uaccess"/);
    assert.match(msg, /ID_MM_DEVICE_IGNORE/);
    assert.match(msg, /sudo udevadm control --reload && sudo udevadm trigger/);
  });

  it('points at ModemManager for a busy Linux port', () => {
    const msg = describeOpenError('/dev/ttyACM0', new Error('Resource busy'), 'linux').message;
    assert.match(msg, /ModemManager/);
  });

  it('leaves other errors and other platforms untouched', () => {
    assert.equal(
      describeOpenError('/dev/ttyACM0', new Error('boom'), 'linux').message,
      'Failed to open /dev/ttyACM0: boom'
    );
    assert.equal(
      describeOpenError('COM3', new Error('Access denied'), 'win32').message,
      'Failed to open COM3: Access denied'
    );
  });
});
