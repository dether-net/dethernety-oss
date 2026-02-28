# Store Review Template Selection Guide

## Quick Decision Tree

**Use this guide to select the appropriate review template for LLM analysis.**

## 🔍 Template Selection

### Simple Store Review (`SIMPLE_STORE_REVIEW.md`)
**Use when the store has:**
- ≤ 5 actions/methods
- Basic state management (UI flags, simple data)
- No external API dependencies
- Single responsibility
- < 100 lines of code

**Examples:**
- Theme/UI preference stores
- Simple form state
- Basic flag management
- Local data manipulation

**Time to review:** ~2-3 minutes

---

### Intermediate Store Review (`INTERMEDIATE_STORE_REVIEW.md`)
**Use when the store has:**
- 5-15 actions/methods
- API integration (1-3 endpoints)
- Cross-store dependencies
- Basic caching needs
- 100-300 lines of code

**Examples:**
- Product catalog stores
- User profile management
- Search/filter functionality
- Basic CRUD operations

**Time to review:** ~5-7 minutes

---

### Enterprise Store Review (`ENTERPRISE_STORE_REVIEW.md`)
**Use when the store has:**
- 15+ actions/methods
- Complex business logic
- Multiple external services
- High-performance requirements
- Critical system functionality
- 300+ lines of code

**Examples:**
- Authentication systems
- Payment processing
- Real-time data synchronization
- Multi-service orchestration
- Mission-critical business logic

**Time to review:** ~10-15 minutes

## 🚦 Red Flags for Immediate Upgrade

### Upgrade to Intermediate if you see:
- `fetch()` or API calls
- Multiple stores being imported
- Caching logic (even basic)
- Complex computed properties
- Error handling beyond try-catch

### Upgrade to Enterprise if you see:
- Race condition patterns (`Promise.all`, concurrent operations)
- Token refresh logic
- Multiple external service integrations
- Performance optimization code
- Complex error classification
- Memory management patterns

## 📊 Analysis Approach

### Step 1: Quick Scan (30 seconds)
```typescript
// Count these indicators:
- Number of exported functions
- Number of external imports (APIs, other stores)
- Presence of async operations
- Complexity of state structure
```

### Step 2: Select Template
```typescript
if (indicators.simple) {
  use('SIMPLE_STORE_REVIEW.md')
} else if (indicators.intermediate) {
  use('INTERMEDIATE_STORE_REVIEW.md')  
} else {
  use('ENTERPRISE_STORE_REVIEW.md')
}
```

### Step 3: Apply Review
- Start with selected template
- Include all patterns from lower complexity levels
- Focus on template-specific critical issues first
- Provide complexity-appropriate recommendations

## 🎯 Review Focus by Template

### Simple Store Focus:
1. Type safety violations
2. Basic error handling
3. State mutation patterns
4. Simple cleanup

### Intermediate Store Focus:
1. All Simple checks +
2. API integration patterns
3. Cross-store coordination
4. Basic performance optimization
5. Caching strategy

### Enterprise Store Focus:
1. All previous checks +
2. Race condition prevention
3. Memory management
4. Advanced error classification
5. Performance monitoring
6. Dependency architecture

## ⚡ Quick Reference Checklist

**Before starting analysis:**
- [ ] Counted total functions/methods
- [ ] Identified external dependencies
- [ ] Assessed code complexity
- [ ] Selected appropriate template
- [ ] Noted any red flags for upgrade

**During analysis:**
- [ ] Applied template-specific critical checks first
- [ ] Included all lower-level template checks
- [ ] Provided complexity-appropriate solutions
- [ ] Assessed if complexity level is appropriate

**Analysis output should include:**
- [ ] Template used and why
- [ ] Complexity assessment (appropriate/over/under-engineered)
- [ ] Issues categorized by priority
- [ ] Specific code examples for fixes
- [ ] Upgrade/downgrade recommendations if needed

## 🔄 Template Inheritance

```
SIMPLE_STORE_REVIEW.md
    ↓ (inherits all checks)
INTERMEDIATE_STORE_REVIEW.md  
    ↓ (inherits all checks)
ENTERPRISE_STORE_REVIEW.md
```

**Always apply lower-level checks first, then add complexity-specific patterns.**
