// Connector permissions per lead agent. Anything not permitted here is blocked.
// A permit tagged @ask("owner") means the owner approves each call before it runs.

// The replies lead (OF4) reads every customer channel and may reply only after the owner approves.
permit (principal == Lead::"replies", action == Action::"read", resource)
when { [Channel::"facebook", Channel::"instagram", Channel::"google_reviews", Channel::"whatsapp"].contains(resource) };

@ask("owner")
permit (principal == Lead::"replies", action == Action::"reply", resource)
when { [Channel::"facebook", Channel::"instagram", Channel::"google_reviews", Channel::"whatsapp"].contains(resource) };

// The ads lead (OF5) reads what customers say on social channels to plan ads. It never answers customers.
permit (principal == Lead::"ads", action == Action::"read", resource)
when { [Channel::"facebook", Channel::"instagram"].contains(resource) };

forbid (principal == Lead::"ads", action == Action::"reply", resource);
