import { describe, it, expect } from 'vitest';
import { classifyBike } from './bike-classify';

describe('classifyBike', () => {
  it('classifica como renting quando sub_status contém "rent"', () => {
    expect(classifyBike({ business_sub_status: 'Renting' })).toBe('renting');
    expect(classifyBike({ business_status: 'renting' })).toBe('renting');
  });

  it('classifica como reserved quando ordered=true', () => {
    expect(classifyBike({ ordered: true })).toBe('reserved');
  });

  it('classifica como reserved quando booked=true', () => {
    expect(classifyBike({ booked: true })).toBe('reserved');
  });

  it('classifica como maintenance quando disabled=true', () => {
    expect(classifyBike({ disabled: true })).toBe('maintenance');
  });

  it('classifica como maintenance quando service_mode=true', () => {
    expect(classifyBike({ service_mode: true })).toBe('maintenance');
  });

  it('classifica como maintenance por sub_status', () => {
    expect(classifyBike({ business_sub_status: 'maintenance' })).toBe('maintenance');
    expect(classifyBike({ business_sub_status: 'low_battery' })).toBe('maintenance');
    expect(classifyBike({ business_sub_status: 'broken' })).toBe('maintenance');
  });

  it('classifica como available para OperationAvailable com bateria ok', () => {
    expect(classifyBike({ business_sub_status: 'OperationAvailable', battery_percent: 0.8 })).toBe('available');
  });

  it('classifica como low_battery para OperationAvailable com bateria < 20%', () => {
    expect(classifyBike({ business_sub_status: 'OperationAvailable', battery_percent: 0.15 })).toBe('low_battery');
    expect(classifyBike({ business_sub_status: 'available', battery_percent: 0.05 })).toBe('low_battery');
  });

  it('fallback para available quando campos desconhecidos', () => {
    expect(classifyBike({})).toBe('available');
    expect(classifyBike({ business_sub_status: 'unknown_status' })).toBe('available');
  });

  it('renting tem prioridade sobre disabled', () => {
    expect(classifyBike({ business_sub_status: 'renting', disabled: true })).toBe('renting');
  });
});
