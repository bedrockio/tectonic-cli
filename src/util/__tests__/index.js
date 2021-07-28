import { validateDomainURL } from './../validation';

describe('validation utils', () => {
  it('should validate domains', async () => {
    expect(validateDomainURL('http://tectonic.io')).toBe(true);
    expect(validateDomainURL('https://tectonic.io')).toBe(true);
    expect(validateDomainURL('http://e-tectonic.io')).toBe(true);
    expect(validateDomainURL('http://api.tectonic.io')).toBe(true);
    expect(validateDomainURL('http://api.staging.tectonic.io')).toBe(true);
    expect(validateDomainURL('http://tectonic.e-tectonic.dev')).toBe(true);

    expect(validateDomainURL('hppt://tectonic.io')).not.toBe(true);
    expect(validateDomainURL('http://no?-tectonic.io')).not.toBe(true);
    expect(validateDomainURL('http://no?.no?-tectonic.io')).not.toBe(true);
  });
});
