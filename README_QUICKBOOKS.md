# Fleet OS - QuickBooks Integration

**Complete QuickBooks Online integration for automatic transaction syncing and operational finance management.**

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env.local

# 3. Configure environment variables
# Edit .env.local with your credentials

# 4. Run database migration
# Copy contents of supabase/migrations/002_quickbooks_integration.sql
# Run in Supabase SQL Editor

# 5. Create storage bucket
# In Supabase Dashboard → Storage → Create bucket: 'receipts'

# 6. Start local development
npm run dev

# 7. Deploy to production
npm run deploy
```

---

## 📚 Documentation

### Getting Started
- **[Quick Setup Guide](QUICKBOOKS_SETUP.md)** - Step-by-step setup (30 mins)
- **[Integration Guide](QUICKBOOKS_INTEGRATION_GUIDE.md)** - Complete technical documentation
- **[Deployment Checklist](DEPLOYMENT_CHECKLIST_QB.md)** - Production deployment guide
- **[MVP Summary](QUICKBOOKS_MVP_SUMMARY.md)** - Implementation overview

### Key Files
- `supabase/migrations/002_quickbooks_integration.sql` - Database schema
- `types/quickbooks.ts` - TypeScript type definitions
- `services/quickbooks.ts` - QuickBooks service layer
- `netlify/functions/qb-*.ts` - API endpoints
- `files/transactions-unassigned.html` - Transaction queue UI

---

## ✨ Features

### 🔄 Automatic Transaction Sync
- Real-time webhook notifications from QuickBooks
- Automatic transaction import
- Duplicate prevention (idempotent)
- Support for Purchase, Expense, Bill, Deposit

### 💰 Bank Balance Sync
- On-demand balance updates
- Multiple account support
- Dashboard integration

### 📝 Transaction Assignment
- Assign to vehicles or mark as overhead
- Categorize expenses
- Add notes and context
- Upload receipts (JPG, PNG, PDF)

### 🔔 Notifications
- In-app notifications for unassigned transactions
- Toast messages for user actions
- Real-time updates

### 🔍 Search & Filter
- Search by vendor, amount, memo
- Filter by type and date range
- Sort and pagination
- Responsive design

---

## 🏗️ Architecture

```
QuickBooks Online
       ↓ (OAuth + Webhooks)
Netlify Functions
       ↓ (Supabase Client)
Supabase (PostgreSQL + Storage)
       ↓ (Supabase JS)
Fleet OS Web App
```

**Tech Stack:**
- TypeScript
- Netlify Functions
- Supabase PostgreSQL
- Supabase Storage
- Tailwind CSS

---

## 🔐 Security

- ✅ OAuth 2.0 authentication
- ✅ Webhook signature verification (HMAC-SHA256)
- ✅ Automatic token refresh
- ✅ Encrypted token storage
- ✅ Private file storage
- ✅ Environment-based secrets

---

## 📊 Database Schema

### New Tables
- `quickbooks_connections` - OAuth tokens
- `financial_accounts` - Bank balances
- `webhook_events` - Audit log
- `notifications` - User notifications
- `sync_jobs` - Background jobs
- `transaction_categories` - Expense categories

### Enhanced Tables
- `transactions` - Added QB-specific fields

---

## 🛠️ API Endpoints

### OAuth
- `GET /.netlify/functions/qb-connect` - Initiate OAuth
- `GET /.netlify/functions/qb-callback` - OAuth callback

### Webhooks
- `POST /.netlify/functions/qb-webhook` - Receive QB events

### Sync
- `POST /.netlify/functions/qb-sync-balances` - Sync balances

---

## 🎯 User Workflow

1. **Connect QuickBooks**
   - Click "Connect QuickBooks"
   - Authorize access
   - Connection saved

2. **Automatic Sync**
   - Transactions created in QB
   - Webhook notification sent
   - Transaction imported automatically

3. **Review & Assign**
   - Open unassigned transactions page
   - Review transaction details
   - Assign to vehicle or overhead
   - Add category and notes
   - Upload receipt (optional)

4. **Dashboard Updates**
   - Assigned transactions appear in P&L
   - Bank balances reflect latest sync
   - Financial reports accurate

---

## 🧪 Testing

### Local Development
```bash
# Start local server
npm run dev

# Test OAuth flow
open http://localhost:8888/.netlify/functions/qb-connect?accountId=1

# Test webhook (use ngrok for local testing)
ngrok http 8888
# Update QB webhook URL to ngrok URL
```

### Production Testing
1. Create test transaction in QuickBooks
2. Verify webhook received (check Netlify logs)
3. Check transaction appears in UI
4. Assign transaction
5. Verify dashboard updates

---

## 🐛 Troubleshooting

### Webhook Not Working
- Verify webhook URL in QB Developer Portal
- Check webhook token matches
- Review Netlify function logs
- Test with QB webhook test tool

### Transactions Not Appearing
- Check `webhook_events` table for errors
- Verify QB connection is active
- Check entity type is supported
- Review function logs

### Token Expired
- Tokens auto-refresh automatically
- If issues persist, reconnect QB
- Check `quickbooks_connections` table

### Receipt Upload Failing
- Verify `receipts` bucket exists
- Check bucket is private
- Verify file type and size
- Check Supabase Storage logs

---

## 📈 Success Metrics

### Technical
- Webhook success rate: >99%
- Function execution: <2s
- Zero data loss
- Idempotent operations

### User Experience
- Assignment time: <2 minutes
- Intuitive UI
- Real-time updates
- Mobile responsive

### Business Value
- Eliminates manual entry
- Real-time visibility
- Accurate P&L
- Audit trail

---

## 🔮 Future Enhancements

### Phase 2
- [ ] Scheduled balance sync
- [ ] Email notifications
- [ ] WhatsApp notifications
- [ ] AI categorization
- [ ] Bulk assignment

### Phase 3
- [ ] Transaction splitting
- [ ] OCR receipt parsing
- [ ] PDF exports
- [ ] Multi-currency
- [ ] Additional data sources

---

## 📦 Project Structure

```
Fleet OS/
├── netlify/
│   └── functions/
│       ├── qb-connect.ts
│       ├── qb-callback.ts
│       ├── qb-webhook.ts
│       └── qb-sync-balances.ts
├── services/
│   └── quickbooks.ts
├── types/
│   └── quickbooks.ts
├── supabase/
│   └── migrations/
│       └── 002_quickbooks_integration.sql
├── files/
│   └── transactions-unassigned.html
├── package.json
├── tsconfig.json
├── .env.example
├── QUICKBOOKS_SETUP.md
├── QUICKBOOKS_INTEGRATION_GUIDE.md
├── DEPLOYMENT_CHECKLIST_QB.md
├── QUICKBOOKS_MVP_SUMMARY.md
└── README_QUICKBOOKS.md (this file)
```

---

## 🤝 Support

### Documentation
- [Setup Guide](QUICKBOOKS_SETUP.md) - Getting started
- [Integration Guide](QUICKBOOKS_INTEGRATION_GUIDE.md) - Technical details
- [Deployment Checklist](DEPLOYMENT_CHECKLIST_QB.md) - Production deployment

### Resources
- [QuickBooks API Docs](https://developer.intuit.com/app/developer/qbo/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Netlify Functions](https://docs.netlify.com/functions/overview/)

### Issues
1. Check documentation
2. Review function logs
3. Check database tables
4. Test with sandbox

---

## 📝 Environment Variables

Required in `.env.local` and Netlify:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key
SUPABASE_ANON_KEY=your_anon_key

# QuickBooks
QB_CLIENT_ID=your_client_id
QB_CLIENT_SECRET=your_client_secret
QB_ENVIRONMENT=sandbox  # or 'production'
QB_WEBHOOK_TOKEN=your_webhook_token

# Netlify
URL=https://your-domain.netlify.app
```

Generate webhook token:
```bash
openssl rand -base64 32
```

---

## ✅ Pre-Deployment Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] Environment variables configured
- [ ] Database migration run
- [ ] Storage bucket created
- [ ] QuickBooks app configured
- [ ] Webhook URL configured
- [ ] OAuth redirect URIs set
- [ ] Functions tested locally
- [ ] End-to-end test completed

---

## 🎉 What's New in v3.0

### Major Features
- ✅ Full QuickBooks OAuth integration
- ✅ Real-time webhook processing
- ✅ Transaction assignment UI
- ✅ Receipt upload to Supabase Storage
- ✅ Bank balance synchronization
- ✅ In-app notifications
- ✅ Comprehensive documentation

### Technical Improvements
- ✅ TypeScript for type safety
- ✅ Modular service architecture
- ✅ Idempotent operations
- ✅ Error handling and retry logic
- ✅ Audit logging
- ✅ Security best practices

---

## 📞 Contact

For questions or issues:
- Review documentation first
- Check troubleshooting guides
- Review function logs
- Contact development team

---

## 📄 License

Private - Internal use only

---

**Version**: 3.0.0  
**Status**: Production Ready  
**Last Updated**: January 2024

---

## 🚦 Getting Started Checklist

1. ☐ Read [QUICKBOOKS_SETUP.md](QUICKBOOKS_SETUP.md)
2. ☐ Install dependencies
3. ☐ Configure environment
4. ☐ Run database migration
5. ☐ Create storage bucket
6. ☐ Configure QuickBooks app
7. ☐ Deploy to Netlify
8. ☐ Configure webhook
9. ☐ Connect QuickBooks
10. ☐ Test transaction flow

**Estimated Setup Time**: 30-45 minutes

---

**Ready to get started? Begin with [QUICKBOOKS_SETUP.md](QUICKBOOKS_SETUP.md)**
