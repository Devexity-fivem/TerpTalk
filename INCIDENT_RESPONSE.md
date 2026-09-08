# TerpTalk Incident Response Plan

## Purpose

This document outlines the procedures for responding to security incidents affecting TerpTalk.

## Incident Classification

### Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **P0 - Critical** | Active exploitation, data breach | < 1 hour | Database breach, admin account compromised, mass data leak |
| **P1 - High** | Security vulnerability discovered | < 4 hours | Authentication bypass, privilege escalation, XSS |
| **P2 - Medium** | Potential vulnerability | < 24 hours | Rate limit bypass, information disclosure |
| **P3 - Low** | Security improvement | < 1 week | Missing security header, weak validation |

## Incident Response Team

**Roles:**
- **Incident Commander** — Overall coordination, decision-making
- **Technical Lead** — Technical investigation and remediation
- **Communications Lead** — User notifications, public statements
- **Legal/Compliance** — Regulatory requirements, user notification

## Incident Response Procedure

### 1. Detection & Analysis (0-1 hour)

**Detection Sources:**
- Security event logs (`SecurityEvent` table)
- User reports
- Automated monitoring alerts
- Third-party notifications
- Social media/security researcher reports

**Initial Assessment:**
- [ ] Verify the incident is real (not false positive)
- [ ] Classify severity level
- [ ] Identify affected systems/users
- [ ] Estimate scope of impact
- [ ] Document timeline of events

### 2. Containment (1-4 hours)

**Immediate Actions:**
- [ ] Isolate affected systems (if possible)
- [ ] Disable compromised accounts
- [ ] Block malicious IPs (via rate limiting or firewall)
- [ ] Revoke compromised sessions/tokens
- [ ] Take affected services offline (if necessary)

**Evidence Preservation:**
- [ ] Preserve logs (don't delete)
- [ ] Screenshot relevant data
- [ ] Document all actions taken
- [ ] Identify attack vector

### 3. Eradication (4-24 hours)

**Remove Threat:**
- [ ] Patch vulnerability
- [ ] Remove malicious code/content
- [ ] Rotate compromised credentials
- [ ] Update security controls
- [ ] Deploy fixes to production

**Verification:**
- [ ] Test fix in staging
- [ ] Verify no backdoors remain
- [ ] Confirm attack vector is closed

### 4. Recovery (24-72 hours)

**Restore Service:**
- [ ] Restore from clean backup (if needed)
- [ ] Verify system integrity
- [ ] Monitor for re-infection
- [ ] Gradual rollout if necessary

**Validation:**
- [ ] Test all affected functionality
- [ ] Verify security controls working
- [ ] Monitor for anomalies

### 5. Lessons Learned (1 week)

**Post-Incident Review:**
- [ ] Document root cause
- [ ] Identify what worked/failed
- [ ] Update security controls
- [ ] Update runbooks/documentation
- [ ] Schedule security review

---

## Specific Incident Types

### Data Breach

**Indicators:**
- Unauthorized database access
- User data exposed in API responses
- Credentials leaked
- Third-party notification of breach

**Response:**
1. **Immediately:**
   - Disable affected accounts
   - Force password resets
   - Rotate all secrets (NEXTAUTH_SECRET, database credentials)
   - Enable additional monitoring

2. **Within 24 hours:**
   - Assess scope of breach (what data, how many users)
   - Determine legal notification requirements
   - Prepare user notification

3. **Within 72 hours (GDPR requirement):**
   - Notify affected users
   - Notify regulatory authorities (if required)
   - Document incident for compliance

**User Notification Template:**
```
Subject: Important Security Notice - TerpTalk

We are writing to inform you of a security incident that may have affected your TerpTalk account.

What happened: [Brief description]
What data was affected: [Specific data types]
When it occurred: [Date/time]
What we're doing: [Remediation steps]
What you should do: [User actions - password reset, etc.]

We take the security of your data seriously and apologize for this incident.

Contact: [support email]
```

### Authentication Bypass / Account Takeover

**Indicators:**
- Multiple failed login attempts
- Successful logins from unusual IPs/locations
- User reports of unauthorized account changes
- JWT token forgery

**Response:**
1. Disable compromised accounts
2. Invalidate all sessions (rotate NEXTAUTH_SECRET)
3. Force password reset for affected users
4. Review security event logs for attack vector
5. Patch vulnerability

### DDoS Attack

**Indicators:**
- Extreme traffic spike
- API endpoints unresponsive
- Legitimate users unable to access

**Response:**
1. Enable rate limiting (if not already)
2. Contact hosting provider (Vercel/Railway)
3. Enable CDN/WAF protection (Cloudflare)
4. Monitor for attack patterns
5. Document attack for future prevention

### Malicious File Upload

**Indicators:**
- Malware detected in uploaded file
- XSS payload in image metadata
- Polyglot file (image + script)

**Response:**
1. Remove malicious file immediately
2. Scan all uploaded files
3. Block uploader's account
4. Review file upload security controls
5. Implement additional validation

### Insider Threat (Malicious Moderator)

**Indicators:**
- Unauthorized content deletions
- Excessive user bans
- Access to private user data
- Audit log anomalies

**Response:**
1. Immediately revoke moderator access
2. Review all actions taken by moderator
3. Restore incorrectly deleted content
4. Notify affected users (if appropriate)
5. Review and update moderation procedures

### Dependency Vulnerability

**Indicators:**
- `npm audit` reports critical vulnerability
- Security advisory for package
- Exploited in the wild

**Response:**
1. Assess if vulnerability affects our usage
2. Update dependency (or apply patch)
3. Test thoroughly
4. Deploy to production
5. Monitor for exploitation attempts

---

## Communication Plan

### Internal Communication
- **Slack/Discord:** `#security-incidents` channel
- **Email:** security@terptalk.com
- **Phone:** [Emergency contact]

### External Communication
- **Status Page:** status.terptalk.com (recommended)
- **Email:** Direct notification to affected users
- **Social Media:** Public statement if incident is public
- **Security Researchers:** security@terptalk.com

### User Notification Criteria

**Notify users if:**
- Their personal data was accessed
- Their account was compromised
- They were directly targeted
- Legal requirement (GDPR: within 72 hours)

**Don't notify if:**
- Incident was contained before user impact
- No user data was affected
- Public disclosure would aid attackers

---

## Post-Incident Actions

### Documentation
- [ ] Complete incident report
- [ ] Update threat model
- [ ] Update security controls
- [ ] Update runbooks

### Improvements
- [ ] Add monitoring for similar attacks
- [ ] Implement additional security controls
- [ ] Update security training
- [ ] Schedule security review

### Legal/Compliance
- [ ] Document for regulatory compliance
- [ ] Notify authorities if required
- [ ] Update privacy policy if needed
- [ ] Review insurance coverage

---

## Security Contacts

**Internal:**
- Security Team: security@terptalk.com
- Development Team: dev@terptalk.com
- Legal: legal@terptalk.com

**External:**
- Hosting Provider: Vercel/Railway support
- Domain Registrar: [Provider] abuse contact
- Law Enforcement: FBI IC3 (if criminal activity)
- Legal Counsel: [Law firm contact]

---

## Testing

**Recommended:**
- Annual incident response tabletop exercise
- Quarterly security drill
- Post-incident reviews after real incidents
- Update this plan based on lessons learned

---

**Last Updated:** 2026-09-08  
**Version:** 1.0  
**Owner:** Security Team
