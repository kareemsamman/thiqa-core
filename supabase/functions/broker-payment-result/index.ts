import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// This edge function handles payment result pages for broker Tranzila payments
// It returns simple HTML that posts a message to the parent window

// Map Tranzila response codes to Hebrew error messages
function getErrorMessage(code: string, reason: string): string {
  // If reason is provided by Tranzila, use it
  if (reason) {
    try {
      return decodeURIComponent(reason)
    } catch {
      return reason
    }
  }
  
  // Map common Tranzila response codes to Hebrew messages
  const errorMessages: Record<string, string> = {
    '003': 'העסקה נדחתה - יש ליצור קשר עם חברת האשראי',
    '004': 'הכרטיס נחסם או שייך לרשימה שחורה',
    '005': 'יש לבצע עסקה טלפונית - התקשר לחברת האשראי',
    '006': 'שגיאה בקוד CVV',
    '009': 'העסקה נכשלה בבדיקת 3DSecure',
    '010': 'שגיאה בתאריך תפוגה',
    '015': 'הכרטיס לא קיים',
    '017': 'העסקה נדחתה - מומלץ לנסות כרטיס אחר',
    '024': 'לא ניתן לבצע עסקה מסוג זה',
    '026': 'הכרטיס אינו תקף',
    '027': 'יש להתקשר לחברת האשראי לאישור טלפוני',
    '028': 'אין הרשאה לביצוע העסקה',
    '029': 'עסקה לא מאושרת לעסק',
    '030': 'בעיה בטרמינל',
    '033': 'כרטיס אינו תקין',
    '034': 'כרטיס לא רשום',
    '035': 'סוג כרטיס לא מורשה לעסק',
    '036': 'הכרטיס פג תוקף',
    '037': 'שגיאה בסכום',
    '038': 'יש להתקשר לחברת האשראי לאישור טלפוני של העסקה',
    '039': 'מספר כרטיס לא תקין',
    '041': 'הכרטיס אבד - יש לפנות לחברת האשראי',
    '043': 'הכרטיס גנוב - יש לפנות לחברת האשראי',
    '051': 'חריגה ממסגרת האשראי',
    '054': 'הכרטיס פג תוקף',
    '055': 'קוד PIN שגוי',
    '057': 'העסקה נדחתה על ידי חברת האשראי',
    '058': 'העסקה אינה מאושרת לעסק',
    '059': 'העסקה נדחתה - בעיה בחברת האשראי',
    '060': 'יש לפנות לחברת האשראי',
    '061': 'חריגה מסכום מקסימלי',
    '062': 'סוג כרטיס מוגבל',
    '063': 'בעיית אימות 3DSecure',
    '065': 'חריגה ממספר עסקאות מותר',
    '075': 'נסיונות שגויים - נא לנסות מאוחר יותר',
    '091': 'שגיאת תקשורת - נסה שוב',
    '096': 'שגיאת מערכת',
    '999': 'שגיאת מערכת - יש לנסות שוב',
  }
  
  return errorMessages[code] || `העסקה נכשלה - קוד שגיאה: ${code}`
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'unknown'
  const settlementId = url.searchParams.get('settlement_id') || ''
  
  // Get Tranzila response data if present
  const responseCode = url.searchParams.get('Response') || url.searchParams.get('response') || ''
  const confirmationCode = url.searchParams.get('ConfirmationCode') || url.searchParams.get('confirmationcode') || ''
  const tranzilaIndex = url.searchParams.get('index') || url.searchParams.get('Index') || ''
  const myid = url.searchParams.get('myid') || url.searchParams.get('Myid') || ''
  
  // Card and installment details
  const ccno = url.searchParams.get('ccno') || url.searchParams.get('Ccno') || ''
  const expdate = url.searchParams.get('expdate') || url.searchParams.get('Expdate') || ''
  const npay = url.searchParams.get('npay') || url.searchParams.get('Npay') || '1'
  
  // Additional error info from Tranzila
  const reason = url.searchParams.get('reason') || url.searchParams.get('Reason') || ''
  const cResp = url.searchParams.get('CResp') || url.searchParams.get('cresp') || ''
  const sum = url.searchParams.get('sum') || url.searchParams.get('Sum') || ''
  
  console.log('Broker payment result page loaded:', { 
    status, settlementId, responseCode, myid, cResp, reason,
    ccno: ccno ? `****${ccno.slice(-4)}` : 'none',
    expdate,
    npay,
    sum
  })

  // Determine actual status from response code
  let finalStatus = status
  if (responseCode === '000' || responseCode === '0') {
    finalStatus = 'success'
  } else if (responseCode && responseCode !== '') {
    finalStatus = 'failed'
  }

  // Extract last 4 digits from card number
  let cardLastFour = ''
  if (ccno && ccno.length >= 4) {
    cardLastFour = ccno.replace(/\*/g, '').slice(-4)
  }

  // Generate error message for failed payments
  const errorMessage = finalStatus === 'failed' ? getErrorMessage(responseCode, reason) : ''
  // URL-encode for safe embedding in JavaScript
  const errorMessageEncoded = encodeURIComponent(errorMessage)

  // Update settlement in database
  if (settlementId) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      const { data: settlement } = await supabase
        .from('broker_settlements')
        .select('id, status')
        .eq('id', settlementId)
        .single()

      if (settlement && settlement.status === 'pending') {
        if (finalStatus === 'success') {
          await supabase
            .from('broker_settlements')
            .update({
              status: 'completed',
              refused: false,
              tranzila_approval_code: confirmationCode,
              card_last_four: cardLastFour || null,
              card_expiry: expdate || null,
              installments_count: npay ? parseInt(npay, 10) : 1,
            })
            .eq('id', settlementId)
        } else if (finalStatus === 'failed') {
          await supabase
            .from('broker_settlements')
            .update({
              status: 'failed',
              refused: true,
            })
            .eq('id', settlementId)
        }
      }
    } catch (e) {
      console.error('Error updating broker settlement:', e)
    }
  }

  const isSuccess = finalStatus === 'success'
  const displaySum = sum || ''
  
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isSuccess ? 'תשלום בוצע בהצלחה' : 'התשלום נכשל'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, ${isSuccess ? '#f0fdf4' : '#fef2f2'} 0%, #ffffff 100%);
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 400px;
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: ${isSuccess ? '#dcfce7' : '#fee2e2'};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon svg {
      width: 48px;
      height: 48px;
      color: ${isSuccess ? '#16a34a' : '#dc2626'};
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: ${isSuccess ? '#16a34a' : '#dc2626'};
      margin-bottom: 12px;
    }
    p {
      font-size: 16px;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .error-reason {
      font-size: 13px;
      color: #9ca3af;
      margin-bottom: 4px;
    }
    .error-detail {
      font-size: 15px;
      color: #374151;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 12px 16px;
      margin: 12px 0;
      line-height: 1.5;
    }
    .card-info {
      background: #f3f4f6;
      border-radius: 8px;
      padding: 12px;
      margin: 16px 0;
    }
    .card-info span {
      display: block;
      font-size: 14px;
      color: #374151;
    }
    .closing {
      font-size: 14px;
      color: #9ca3af;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      ${isSuccess 
        ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>'
      }
    </div>
    ${isSuccess 
      ? `<h1>התשלום בוצע בהצלחה!</h1>
         <p>הדפעה נרשמה לוסיט</p>`
      : `<h1>${displaySum ? `עסקה בסך ₪${displaySum} נכשלה` : 'התשלום נכשל'}</h1>
         <p class="error-reason">סיבת הכשלון:</p>
         <div class="error-detail">${errorMessage}</div>`
    }
    ${isSuccess && cardLastFour ? `
    <div class="card-info">
      <span>כרטיס: ****${cardLastFour}</span>
      ${parseInt(npay) > 1 ? `<span>מספר תשלומים: ${npay}</span>` : ''}
    </div>
    ` : ''}
    ${!isSuccess && cardLastFour ? `
    <div class="card-info">
      <span>אמצעי תשלום: כרטיס אשראי המסתיים ב-${cardLastFour}</span>
    </div>
    ` : ''}
    <p class="closing">החלון ייסגר אוטומטית...</p>
  </div>
  
  <script>
    function sendMessage() {
      try {
        var msg = {
          type: 'BROKER_PAYMENT_RESULT',
          status: '${finalStatus}',
          settlement_id: '${settlementId}',
          card_last_four: '${cardLastFour}',
          installments: ${npay || 1},
          error_code: '${responseCode}',
          error_message: decodeURIComponent('${errorMessageEncoded}')
        };
        
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(msg, '*');
        }
        if (window.top && window.top !== window) {
          window.top.postMessage(msg, '*');
        }
      } catch(e) {
        console.log('Could not post message:', e);
      }
    }
    
    sendMessage();
    setTimeout(sendMessage, 100);
    setTimeout(sendMessage, 300);
    setTimeout(sendMessage, 500);
    setTimeout(sendMessage, 1000);
    setTimeout(sendMessage, 2000);
  </script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
})
