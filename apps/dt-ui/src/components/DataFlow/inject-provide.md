**Why emitting events didn't work:**
1. **JSON Forms creates a nested component tree** internally
2. **Our custom renderer is deeply nested** inside JSON Forms' internal structure
3. **Vue events only bubble up one level** by default
4. **JSON Forms doesn't automatically forward custom events** from renderers

So when our `CustomCategorizationRenderer` emitted the event:
```javascript
emit('panel-opened', eventData) // This goes to JSON Forms internal component
```

It got "trapped" inside JSON Forms and never reached our `AttributesDialog.vue`.

## Why provide/inject Was the Solution

`provide`/`inject` **bypasses the component hierarchy** entirely:

```javascript
// AttributesDialog.vue (grandparent)
provide('panelOpenedHandler', handlePanelOpened)

// CustomCategorizationRenderer.vue (deeply nested grandchild)
const panelOpenedHandler = inject('panelOpenedHandler')
panelOpenedHandler(eventData) // Direct function call!
```

## When to Use Each Approach

### ✅ **Use Event Emission When:**
- **Direct parent-child relationship**
- **Standard Vue components** (not third-party libraries)
- **You control the entire component tree**
- **You want loose coupling**

```vue
<!-- Simple case - direct parent/child -->
<MyButton @click="handleClick" />
```

### ✅ **Use provide/inject When:**
- **Deep component nesting** (grandparent → grandchild)
- **Third-party libraries** that don't forward events
- **Cross-cutting concerns** (themes, auth, etc.)
- **You need to bypass intermediate components**

```vue
<!-- Complex case - deep nesting through third-party -->
<JsonForms>
  <!-- JSON Forms internal components -->
    <CustomRenderer /> <!-- Your component is buried here -->
</JsonForms>
```

## Hybrid Approach (What We Used)

We actually used **both** patterns:

```javascript
// Emit for Vue DevTools and potential direct listeners
emit('panel-opened', eventData)

// Inject for guaranteed delivery to the intended parent
if (panelOpenedHandler) {
  panelOpenedHandler(eventData)
}
```

This gives us:
- **Reliability**: `provide`/`inject` ensures the event reaches its destination
- **Debuggability**: Emitted events show up in Vue DevTools
- **Flexibility**: Future direct parent components could listen to the emit
