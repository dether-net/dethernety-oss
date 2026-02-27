---
title: 'Complete Examples: From Start to Finish'
description: 'Three complete threat modeling scenarios showing the entire workflow from model creation to issue resolution.'
category: 'examples'
position: 9
navigation: true
tags: ['intermediate', 'tutorial', 'detailed', 'practical', 'modeling', 'analysis', 'controls', 'issues', 'web-app', 'microservices', 'cloud', 'end-to-end']
---

# Complete Examples: From Start to Finish

*Three complete threat modeling scenarios showing the entire workflow from model creation to issue resolution.*

## Example 1: Simple Web Application (20 minutes)

**Scenario:** A small e-commerce website with user authentication and payment processing.

### **Step 1: Create and Configure Model (3 minutes)**

**Create Model:**
```
Browser → Menu → Create Model
Name: "SimpleCommerce Store"
Description: "Small online store with user accounts and Stripe payment integration"
Modules: Web Application Module, Payment Module (if available)
→ Open Data Flow Editor
```

### **Step 2: Build Architecture (8 minutes)**

**Add Components:**
1. **Web Server** (Process)
   - Name: "Frontend Server"
   - Class: nginx Web Server
   - Config: HTTPS, Port 443, Session auth, Rate limiting

2. **Database** (Data Store)
   - Name: "Customer Database"
   - Class: PostgreSQL
   - Config: TLS encryption, connection pooling

3. **Payment Service** (Process)
   - Name: "Payment Handler"
   - Class: Payment Processing Service
   - Config: Stripe integration, tokenization

4. **Users** (External Entity)
   - Name: "Customers"
   - Type: External users
   - Trust: Untrusted

**Connect Data Flows:**
1. **Customers → Frontend Server**
   - Name: "Web Traffic"
   - Protocol: HTTPS
   - Data: Login credentials, orders

2. **Frontend → Customer Database**
   - Name: "Customer Data"
   - Protocol: PostgreSQL/TLS
   - Data: User accounts, order history

3. **Frontend → Payment Handler**
   - Name: "Payment Requests"
   - Protocol: Internal HTTPS
   - Data: Payment details, amounts

### **Step 3: Run Analysis (4 minutes)**

**Execute Analysis:**
```
Click model name → Analysis tab → Select "Basic Security Assessment"
→ New Analysis → Name: "Pre-launch Security Review"
→ Click creation icon (✨)
```

**Interact with Analysis:**
- Answer AI questions about authentication methods
- Confirm payment card data handling
- Provide compliance requirements (PCI DSS)

**Typical Results Found:**
- **Critical**: Unencrypted payment data transmission
- **High**: Missing input validation on forms
- **High**: Weak session management
- **Medium**: Missing security headers
- **Medium**: No rate limiting on login

### **Step 4: Create and Track Issues (3 minutes)**

**Create Critical Issues:**
1. **Payment Security Issue**
   ```
   Analysis → Select "Unencrypted payment data" → Create Issue
   Type: Security Incident
   Name: "Critical: Payment Data Encryption Missing"
   Assignee: Backend Team Lead
   ```

2. **Input Validation Issue**
   ```
   Analysis → Select "Missing input validation" → Create Issue
   Type: Remediation Task
   Name: "Implement Input Validation Framework"
   Assignee: Full-Stack Developer
   ```

**Add Related Findings:**
```
Analysis → Select "Weak session management" → Add to Issue
→ System redirects to Issues page
→ Filter: name:Payment → Open payment security issue
→ Add from Clipboard
```

### **Step 5: Implement Controls (2 minutes)**

**Add Security Controls:**
```
Component: Payment Handler → Controls tab
→ Assign Control: "PCI DSS Payment Security Package"
→ Configure: Enable encryption, tokenization, audit logging

Component: Frontend Server → Controls tab
→ Assign Control: "Web Application Security Bundle"
→ Configure: Input validation, security headers, rate limiting
```

**Verify Protection:**
- Component → Countermeasures tab shows active protection
- Re-run analysis shows reduced critical findings

---

## Example 2: Microservices Architecture (35 minutes)

**Scenario:** A complex banking application with microservices, API gateway, and multiple databases.

### **Model Structure (15 minutes)**

**Core Components:**
- API Gateway (nginx + Kong)
- Authentication Service (OAuth2/JWT)
- Account Service (Node.js)
- Transaction Service (Java Spring)
- Notification Service (Python)
- User Database (PostgreSQL)
- Transaction Database (PostgreSQL)
- Cache Layer (Redis)
- Message Queue (RabbitMQ)

**Security Boundaries:**
- Internet Boundary (default)
- DMZ Zone (API Gateway)
- Application Zone (microservices)
- Data Zone (databases, cache)

**Key Data Flows:**
- Mobile App → API Gateway → Services
- Service-to-service communication
- Database connections with connection pooling
- Message queue for async processing

### **Advanced Analysis (12 minutes)**

**Analysis Types:**
1. **Comprehensive Threat Analysis** (AI-powered)
2. **MITRE ATT&CK Assessment**
3. **PCI DSS Compliance Review**

**Complex Findings:**
- **Critical**: Service-to-service authentication gaps
- **Critical**: Database connection credential management
- **High**: API rate limiting bypass potential
- **High**: Message queue unauthorized access
- **Medium**: Service mesh security gaps

### **Enterprise Issue Management (8 minutes)**

**Issue Categories:**
- **Infrastructure Security** (network, containers, orchestration)
- **Application Security** (code, APIs, data validation)
- **Compliance Issues** (PCI DSS, SOX, regulatory)
- **Operational Security** (monitoring, incident response)

**External Integration:**
- Sync with Jira for development tracking
- ServiceNow integration for infrastructure changes
- Slack notifications for critical findings

---

## Example 3: Cloud Infrastructure (25 minutes)

**Scenario:** AWS-based web application with auto-scaling, managed databases, and CDN.

### **Cloud Architecture (10 minutes)**

**AWS Components:**
- CloudFront (CDN)
- Application Load Balancer
- ECS Containers (web app)
- RDS PostgreSQL (Multi-AZ)
- ElastiCache Redis
- S3 Buckets (static files, backups)
- Lambda Functions (serverless processing)

**Security Services:**
- AWS WAF
- CloudTrail (logging)
- GuardDuty (threat detection)
- IAM Roles and Policies

### **Cloud Security Analysis (8 minutes)**

**Cloud-Specific Analysis:**
```
Analysis Type: "AWS Security Assessment"
Focus Areas:
- IAM permission models
- Data encryption at rest and in transit
- Network security groups
- S3 bucket policies
- Container security
```

**Cloud Findings:**
- **Critical**: S3 bucket public read access
- **High**: Over-privileged IAM roles
- **High**: Missing CloudTrail in sensitive regions
- **Medium**: Unencrypted EBS volumes
- **Medium**: Security group rules too permissive

### **Cloud Remediation (7 minutes)**

**Infrastructure Controls:**
- **S3 Security Control**: Block public access, encryption, versioning
- **IAM Control**: Principle of least privilege, MFA requirements
- **Network Control**: Security groups, NACLs, VPC flow logs
- **Monitoring Control**: CloudTrail, GuardDuty, automated alerting

**DevSecOps Integration:**
- Terraform infrastructure as code
- Automated security scanning in CI/CD
- Policy-as-code with OPA/Rego
- Continuous compliance monitoring

---

## Common Patterns Across Examples

### **Analysis Strategy Patterns**

**Start Simple → Add Complexity:**
1. Basic security assessment first
2. Add specialized analysis (compliance, cloud, etc.)
3. Re-analyze after implementing controls

**Iterative Improvement:**
1. Model → Analyze → Fix Critical → Re-analyze
2. Add security controls incrementally
3. Verify improvements with subsequent analysis

### **Issue Management Patterns**

**Priority-Based Workflow:**
1. **Critical/High**: Immediate action, stop deployment if necessary
2. **Medium**: Current development cycle
3. **Low**: Future planning and hardening

**Team Coordination:**
1. **Security Team**: Review all findings, prioritize remediation
2. **Development Teams**: Implement fixes, update models
3. **Operations Team**: Deploy security controls, monitoring

### **Control Implementation Patterns**

**Layered Security:**
1. **Network Layer**: Firewalls, segmentation, encryption
2. **Application Layer**: Input validation, authentication, authorization
3. **Data Layer**: Encryption, access controls, backup security
4. **Operational Layer**: Monitoring, logging, incident response

**Reusable Control Libraries:**
1. **Web Application Security Package**: Standard controls for web apps
2. **Database Security Package**: Encryption, access, monitoring
3. **Cloud Security Package**: Cloud-specific protections
4. **Compliance Packages**: Industry-specific requirements

## Key Success Factors

### **Model Quality**
- **Accuracy**: Model reflects actual system architecture
- **Completeness**: Include all critical components and data flows
- **Currency**: Keep models updated as systems evolve

### **Analysis Effectiveness**
- **Regular Execution**: Analyze after significant changes
- **Multiple Perspectives**: Use different analysis types
- **AI Interaction**: Provide detailed context to AI analysis

### **Issue Resolution**
- **Clear Ownership**: Every issue assigned to specific person/team
- **Traceability**: Maintain connection from finding to resolution
- **Progress Tracking**: Regular status updates and completion verification

---

**Practice Exercises:**
1. **Start with Example 1**: Build the simple web application model
2. **Extend to Microservices**: Add complexity gradually
3. **Add Cloud Components**: Incorporate managed services and infrastructure

**Next Steps:**
- **[Quick Start Guide](quick-start-guide.md)**: Begin with basic concepts
- **[Security Analysis Workflow](security-analysis-workflow.md)**: Deep dive into analysis techniques
- **[Issue Management Guide](issue-management-guide.md)**: Master issue tracking and resolution