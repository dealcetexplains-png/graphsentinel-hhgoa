export const policies = {
  OUTBOUND_RESTRICTION: {
    id: 'FRD-4.2',
    title: 'Suspected account takeover',
    threshold: 0.78,
    approval: 'Level 2 fraud analyst',
    reversible: true,
  },
  CUSTOMER_CHALLENGE: {
    id: 'IAM-2.1',
    title: 'Step-up customer verification',
    threshold: 0.58,
    approval: 'No approval required',
    reversible: true,
  },
}

export const cases = [
  {
    id: 'FI-2048',
    customer: 'Maya Chen',
    account: '•• 1842',
    trigger: 'High-risk transfer',
    amount: 42800,
    currency: 'USD',
    riskScore: 91,
    priorRiskScore: 68,
    status: 'Investigating',
    priority: 'Critical',
    openedAt: 'Today, 09:42',
    age: '18 min',
    owner: 'A. Rivera',
    transactionId: 'TXN-884218',
    summary: 'A first-time wire to a newly created beneficiary followed a password reset and an impossible-travel login.',
    indicators: ['new_device', 'impossible_travel', 'new_beneficiary', 'password_reset', 'high_value_wire', 'mule_link'],
    evidence: [
      { id: 'EV-1', type: 'Identity', title: 'Impossible travel detected', detail: 'Singapore login 47 minutes after a verified Austin session', strength: 0.92, source: 'Identity graph', icon: 'fingerprint' },
      { id: 'EV-2', type: 'Device', title: 'Untrusted device', detail: 'Device first seen today; shared with 3 flagged accounts', strength: 0.88, source: 'Device intelligence', icon: 'monitor' },
      { id: 'EV-3', type: 'Transaction', title: 'Novel beneficiary', detail: 'Recipient opened 12 days ago and is two hops from a known mule', strength: 0.85, source: 'TigerGraph traversal', icon: 'route' },
      { id: 'EV-4', type: 'Behavior', title: 'Sequence anomaly', detail: 'Password reset → beneficiary added → wire in 31 minutes', strength: 0.9, source: 'Pattern engine', icon: 'activity' },
      { id: 'EV-5', type: 'Customer', title: 'Transaction not recognized', detail: 'Customer denied initiating the transfer via secure challenge', strength: 0.98, source: 'Customer response', icon: 'message' },
    ],
    graph: {
      nodes: [
        { id: 'maya', label: 'Maya Chen', sublabel: 'Customer', kind: 'customer', x: 335, y: 205, risk: 'safe' },
        { id: 'acct', label: '•• 1842', sublabel: 'Origin account', kind: 'account', x: 220, y: 122, risk: 'high' },
        { id: 'device', label: 'DVC-9021', sublabel: 'New device', kind: 'device', x: 443, y: 90, risk: 'high' },
        { id: 'ip', label: '103.12.44.8', sublabel: 'Singapore IP', kind: 'ip', x: 540, y: 180, risk: 'medium' },
        { id: 'txn', label: '$42.8K wire', sublabel: 'Flagged transfer', kind: 'transaction', x: 333, y: 338, risk: 'high' },
        { id: 'recipient', label: 'Rapid LLC', sublabel: 'Beneficiary', kind: 'merchant', x: 157, y: 303, risk: 'high' },
        { id: 'mule', label: 'Mule cluster #17', sublabel: 'Known pattern', kind: 'risk', x: 84, y: 183, risk: 'high' },
        { id: 'known', label: '•• 7720', sublabel: 'Flagged account', kind: 'account', x: 78, y: 383, risk: 'medium' },
      ],
      edges: [
        { from: 'maya', to: 'acct', label: 'owns' },
        { from: 'maya', to: 'device', label: 'logged in' },
        { from: 'device', to: 'ip', label: 'used' },
        { from: 'acct', to: 'txn', label: 'initiated' },
        { from: 'txn', to: 'recipient', label: 'sent to' },
        { from: 'recipient', to: 'mule', label: '2-hop link', suspicious: true },
        { from: 'recipient', to: 'known', label: 'shares device', suspicious: true },
        { from: 'acct', to: 'mule', label: 'pattern match', suspicious: true },
      ],
    },
  },
  {
    id: 'FI-2047', customer: 'Noah Williams', account: '•• 5507', trigger: 'Device cluster', amount: 18750, currency: 'USD', riskScore: 78, priorRiskScore: 54, status: 'Needs review', priority: 'High', openedAt: 'Today, 09:17', age: '43 min', owner: 'Unassigned', transactionId: 'TXN-884102', summary: 'A familiar account authenticated from a device shared across a suspicious recipient cluster.', indicators: ['shared_device', 'new_beneficiary', 'velocity'], evidence: [], graph: { nodes: [], edges: [] },
  },
  {
    id: 'FI-2045', customer: 'Elias Grant', account: '•• 0391', trigger: 'Customer report', amount: 3200, currency: 'USD', riskScore: 64, priorRiskScore: 61, status: 'Evidence requested', priority: 'Medium', openedAt: 'Today, 08:36', age: '1h 24m', owner: 'L. Okafor', transactionId: 'TXN-883901', summary: 'Customer reported card-not-present activity; device evidence remains ambiguous.', indicators: ['customer_report', 'card_not_present'], evidence: [], graph: { nodes: [], edges: [] },
  },
  {
    id: 'FI-2041', customer: 'Priya Shah', account: '•• 6104', trigger: 'Rapid fan-out', amount: 67400, currency: 'USD', riskScore: 95, priorRiskScore: 83, status: 'Approval pending', priority: 'Critical', openedAt: 'Today, 07:55', age: '2h 05m', owner: 'J. Foster', transactionId: 'TXN-883771', summary: 'Funds moved through six recently created beneficiaries in a rapid fan-out.', indicators: ['fan_out', 'mule_link', 'velocity'], evidence: [], graph: { nodes: [], edges: [] },
  },
  {
    id: 'FI-2039', customer: 'Orion Supplies', account: '•• 9218', trigger: 'Unusual payment', amount: 8930, currency: 'USD', riskScore: 28, priorRiskScore: 43, status: 'Cleared', priority: 'Low', openedAt: 'Yesterday, 17:48', age: '16h', owner: 'A. Rivera', transactionId: 'TXN-883650', summary: 'Invoice and device history were consistent with the customer’s normal business activity.', indicators: ['high_value'], evidence: [], graph: { nodes: [], edges: [] },
  },
]

export const priorCases = [
  { id: 'FI-1882', outcome: 'Confirmed ATO', similarity: 0.91, indicators: ['new_device', 'impossible_travel', 'new_beneficiary', 'password_reset', 'mule_link'], action: 'Restricted outbound transfers', lossPrevented: 61000 },
  { id: 'FI-1734', outcome: 'Confirmed ATO', similarity: 0.84, indicators: ['new_device', 'password_reset', 'high_value_wire'], action: 'Challenged customer and blocked wire', lossPrevented: 35500 },
  { id: 'FI-1690', outcome: 'False positive', similarity: 0.42, indicators: ['new_device', 'new_beneficiary'], action: 'Allowed after step-up', lossPrevented: 0 },
]
