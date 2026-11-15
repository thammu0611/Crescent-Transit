// Reading bus papers from their text: kind, number, expiry, odometer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDates, findExpiry, findOdometer, findRegistration, readDocument } from '../shared/docscan.js';

test('dates in the formats Indian papers use', () => {
  const iso = (t) => findDates(t).map((d) => d.iso);
  assert.deepEqual(iso('12/05/2027'), ['2027-05-12']);
  assert.deepEqual(iso('12-05-27'), ['2027-05-12']);
  assert.deepEqual(iso('12.05.2027'), ['2027-05-12']);
  assert.deepEqual(iso('12 May 2027'), ['2027-05-12']);
  assert.deepEqual(iso('12-MAY-2027'), ['2027-05-12']);
  assert.deepEqual(iso('May 12, 2027'), ['2027-05-12']);
  assert.deepEqual(iso('2027-05-12'), ['2027-05-12']);
  assert.deepEqual(iso('31/02/2027 and 45/13/2027'), []); // not real dates
});

test('motor insurance policy schedule', () => {
  const text = `NEW INDIA ASSURANCE CO. LTD  Motor Insurance - Commercial Vehicle Package Policy
    Policy No: 71110031260100001234   Registration No: TN 22 AB 4521
    Period of Insurance: From 00:00 hrs on 01/06/2026 To Midnight of 31/05/2027
    Date of issue: 28/05/2026  Premium: Rs 48,210`;
  const r = readDocument(text);
  assert.equal(r.kind, 'INSURANCE');
  assert.equal(r.number, '71110031260100001234');
  assert.equal(r.expiresOn, '2027-05-31');
  assert.equal(r.registration, 'TN22AB4521');
  assert.equal(r.confidence, 'high');
});

test('fitness certificate', () => {
  const text = `FORM 38 CERTIFICATE OF FITNESS (Transport Vehicles)
    Certificate No.: TN22F2026004512  Vehicle Regn. No.: TN-22-AB-4521
    Date of inspection: 15-Jan-2026  Fitness valid upto: 14-Jan-2027`;
  const r = readDocument(text);
  assert.equal(r.kind, 'FITNESS');
  assert.equal(r.number, 'TN22F2026004512');
  assert.equal(r.expiresOn, '2027-01-14');
});

test('permit', () => {
  const text = `Government of Tamil Nadu  Educational Institution Bus Permit
    Permit No: EIB/2025/00871  Valid from 10.08.2025 Valid till 09.08.2030`;
  const r = readDocument(text);
  assert.equal(r.kind, 'PERMIT');
  assert.equal(r.number, 'EIB/2025/00871');
  assert.equal(r.expiresOn, '2030-08-09');
});

test('PUC certificate, even with an insurance line in small print', () => {
  const text = `POLLUTION UNDER CONTROL CERTIFICATE  Certificate SL No: TN0220260045871
    Vehicle No TN22AB4521  Date of test 02/03/2026  Validity upto 01/09/2026
    Keep this with your insurance papers.`;
  const r = readDocument(text);
  assert.equal(r.kind, 'PUC');
  assert.equal(r.number, 'TN0220260045871');
  assert.equal(r.expiresOn, '2026-09-01');
});

test('service bill: odometer and service date', () => {
  const text = `ASHOK LEYLAND AUTHORISED SERVICE  Service Invoice  Job Card No 55871
    Vehicle: TN22AB4521   Odometer Reading: 1,24,560 km   Date: 18/10/2026`;
  const r = readDocument(text);
  assert.equal(r.kind, 'SERVICE');
  assert.equal(r.odometerKm, 124560);
  assert.equal(r.serviceOn, '2026-10-18');
});

test('the person can say which document it is', () => {
  const r = readDocument('No. AB1234567 valid till 05/06/2028', 'PERMIT');
  assert.equal(r.kind, 'PERMIT');
  assert.equal(r.expiresOn, '2028-06-05');
});

test('nothing recognisable', () => {
  const r = readDocument('hello world');
  assert.equal(r.kind, null);
  assert.equal(r.confidence, 'none');
  assert.equal(findExpiry('no dates here'), null);
  assert.equal(findOdometer('no reading'), null);
  assert.equal(findRegistration('none'), null);
});
