import { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { api } from '../lib/api.js';
import { rupees } from '../lib/format.js';
import { C } from '../theme.js';
import { Button, GlassBackdrop, Collapsible, ErrorText, Row, Segmented, Select, Sheet, Txt } from './ui.js';

/** Razorpay's own hosted checkout, loaded in a web view (no native SDK needed). */
function razorpayPage(order) {
  const options = {
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amountPaise,
    currency: 'INR',
    name: order.merchant,
    description: order.planName,
    prefill: order.prefill ?? {},
  };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script></head><body style="background:#f1f1f1">
<script>
  function post(m){ window.ReactNativeWebView.postMessage(m); }
  try {
    var o = ${JSON.stringify(options).replace(/</g, '\\u003c')};
    o.handler = function(){ post('success'); };
    o.modal = { ondismiss: function(){ post('dismiss'); } };
    var rzp = new Razorpay(o);
    rzp.on('payment.failed', function(){ post('failure'); });
    rzp.open();
  } catch (e) { post('error:' + e.message); }
</script></body></html>`;
}

/**
 * The payment step (doc 8.3 step 4). With Razorpay keys configured on the
 * server this opens Razorpay's hosted checkout; otherwise the built-in test
 * gateway's checkout. Either way the app never decides that a payment
 * succeeded: it waits for the server, which only believes the signed webhook.
 */
export default function Checkout({ order, onClose, onDone }) {
  const [method, setMethod] = useState('upi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [webhook, setWebhook] = useState('deliver');

  if (order.gateway === 'razorpay') {
    return (
      <Modal visible animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          <GlassBackdrop />
          <Row style={{ padding: 12 }}>
            <Txt bold style={{ flex: 1 }}>{order.planName} · {rupees(order.amountPaise)}</Txt>
            <Button title="Close" variant="ghost" small onPress={onClose} />
          </Row>
          <ErrorText>{error}</ErrorText>
          <WebView
            originWhitelist={['*']}
            source={{ html: razorpayPage(order), baseUrl: 'https://checkout.razorpay.com' }}
            javaScriptEnabled
            onMessage={(e) => {
              const m = e.nativeEvent.data;
              // The handler's success is a claim: the app re-reads the entitlement,
              // which the server sets only from the verified webhook.
              if (m === 'success') onDone('success');
              else if (m === 'failure') onDone('failure');
              else if (m === 'dismiss') onClose();
              else if (m.startsWith('error:')) setError('Could not load the Razorpay checkout. Check the connection and try again.');
            }}
          />
        </SafeAreaView>
      </Modal>
    );
  }

  const payMock = async (outcome) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/mock-gateway/orders/${order.orderId}/pay`, { body: { method, outcome, webhook } });
      onDone(outcome);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Test payment gateway" onClose={busy ? undefined : onClose}>
      <View style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between', backgroundColor: C.navy50, padding: 12, borderRadius: 12 }}>
          <Txt bold style={{ flexShrink: 1 }}>{order.merchant}</Txt>
          <Txt bold style={{ fontSize: 20 }}>{rupees(order.amountPaise)}</Txt>
        </Row>
        <Txt muted small>
          {order.planName}. This is the built-in test-mode gateway: no money moves. It signs its notification to the server exactly as Razorpay does.
        </Txt>
        <Segmented value={method} onChange={setMethod} options={[{ value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'netbanking', label: 'Netbanking' }]} />
        <Collapsible title="Failure testing">
          <Select
            label="Webhook delivery"
            value={webhook}
            onChange={setWebhook}
            options={[
              { value: 'deliver', label: 'Deliver normally' },
              { value: 'twice', label: 'Deliver twice (duplicate)' },
              { value: 'drop', label: 'Never arrives (reconciliation repairs it)' },
            ]}
          />
        </Collapsible>
        <ErrorText>{error}</ErrorText>
        <Button title={busy ? 'Processing…' : `Pay ${rupees(order.amountPaise)}`} busy={busy} onPress={() => payMock('success')} />
        <Button title="Simulate a declined payment" variant="ghost" disabled={busy} onPress={() => payMock('failure')} />
      </View>
    </Sheet>
  );
}
