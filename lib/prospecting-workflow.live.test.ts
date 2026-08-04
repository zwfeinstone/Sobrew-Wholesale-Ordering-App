import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const RUN_LIVE = process.env.RUN_LIVE_SUPABASE_TEST === '1';

describe.skipIf(!RUN_LIVE)('prospecting workflow live Supabase', () => {
  it('shucks a parked lead atomically and rolls back a later contact failure', async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is required').toBeTruthy();
    expect(serviceRole, 'SUPABASE_SERVICE_ROLE_KEY is required').toBeTruthy();

    const supabase = createClient(supabaseUrl!, serviceRole!, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const { data: actor, error: actorError } = await supabase
      .from('profiles')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    expect(actorError).toBeNull();
    expect(actor?.id, 'active profile is required').toBeTruthy();

    const token = randomUUID();
    const companyName = `Codex Prospecting Workflow ${token}`;
    const companyNameKey = `codex-prospecting-workflow-${token}`;
    let leadId = '';

    try {
      const { data: lead, error: leadError } = await supabase
        .from('prospecting_leads')
        .insert({
          assigned_profile_id: actor!.id,
          company_name: companyName,
          company_name_key: companyNameKey,
          created_by: actor!.id,
          hubspot_status: 'queued',
          next_follow_up_at: '2026-08-01',
          phone_key: '',
          stage: 'interested',
          updated_by: actor!.id,
        })
        .select('id,updated_at')
        .single();
      expect(leadError).toBeNull();
      expect(lead?.id).toBeTruthy();
      leadId = lead!.id;

      const { data: contact, error: contactError } = await supabase
        .from('prospecting_contacts')
        .insert({
          created_by: actor!.id,
          full_name: 'Before Contact',
          is_primary: true,
          lead_id: leadId,
          updated_by: actor!.id,
        })
        .select('id')
        .single();
      expect(contactError).toBeNull();
      expect(contact?.id).toBeTruthy();

      const { error: queueError } = await supabase.from('prospecting_hubspot_queue').insert({
        lead_id: leadId,
        queued_by: actor!.id,
        queued_stage: 'interested',
        status: 'queued',
      });
      expect(queueError).toBeNull();

      const parkedLeadPayload = {
        address_line_1: null,
        address_line_2: null,
        assigned_profile_id: actor!.id,
        city: null,
        company_email: null,
        company_name: companyName,
        company_name_key: companyNameKey,
        company_website: null,
        country: null,
        do_not_contact: false,
        next_follow_up_at: '2026-08-08',
        notes: null,
        phone: null,
        phone_key: '',
        postal_code: null,
        priority: 'normal',
        stage: 'recycle_try_later',
        state: null,
        state_key: null,
      };
      const { data: saved, error: saveError } = await supabase.rpc('save_prospecting_record_v1', {
        p_actor_id: actor!.id,
        p_activity: {
          activity_type: 'call',
          body: 'Live workflow verification.',
          contact_id: contact!.id,
          next_follow_up_at: null,
          next_stage: 'recycle_try_later',
          previous_assigned_profile_id: actor!.id,
          previous_stage: 'interested',
          result: 'Call back later',
        },
        p_audit_activities: [{
          activity_type: 'assignment',
          body: 'Lead recycled to the unassigned pool.',
          next_stage: 'recycle_try_later',
          previous_assigned_profile_id: actor!.id,
          previous_stage: 'interested',
          result: 'Unassigned',
        }],
        p_contact_updates: [{
          email: null,
          full_name: 'Updated Contact',
          id: contact!.id,
          is_primary: true,
          notes: null,
          phone: null,
          title: null,
        }],
        p_expected_updated_at: lead!.updated_at,
        p_lead: parkedLeadPayload,
        p_lead_id: leadId,
        p_new_contact: null,
      });
      expect(saveError).toBeNull();
      expect(saved).toMatchObject({
        assigned_profile_id: null,
        next_follow_up_at: null,
        stage: 'recycle_try_later',
      });

      const [{ data: parkedLead }, { data: updatedContact }, { data: queue }, { data: activities }] = await Promise.all([
        supabase.from('prospecting_leads').select('assigned_profile_id,company_name,next_follow_up_at,stage,updated_at').eq('id', leadId).single(),
        supabase.from('prospecting_contacts').select('full_name').eq('id', contact!.id).single(),
        supabase.from('prospecting_hubspot_queue').select('lead_id').eq('lead_id', leadId).maybeSingle(),
        supabase.from('prospecting_activities').select('activity_type,result').eq('lead_id', leadId),
      ]);
      expect(parkedLead).toMatchObject({
        assigned_profile_id: null,
        company_name: companyName,
        next_follow_up_at: null,
        stage: 'recycle_try_later',
      });
      expect(updatedContact?.full_name).toBe('Updated Contact');
      expect(queue).toBeNull();
      expect(activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ activity_type: 'call', result: 'Call back later' }),
        expect.objectContaining({ activity_type: 'assignment', result: 'Unassigned' }),
      ]));

      const { error: rollbackError } = await supabase.rpc('save_prospecting_record_v1', {
        p_actor_id: actor!.id,
        p_activity: null,
        p_audit_activities: [],
        p_contact_updates: [{ id: randomUUID(), full_name: 'Missing Contact' }],
        p_expected_updated_at: parkedLead!.updated_at,
        p_lead: { ...parkedLeadPayload, company_name: 'This Must Roll Back' },
        p_lead_id: leadId,
        p_new_contact: null,
      });
      expect(rollbackError?.code).toBe('P0002');

      const { data: afterRollback, error: afterRollbackError } = await supabase
        .from('prospecting_leads')
        .select('company_name,updated_at')
        .eq('id', leadId)
        .single();
      expect(afterRollbackError).toBeNull();
      expect(afterRollback).toEqual({
        company_name: companyName,
        updated_at: parkedLead!.updated_at,
      });
    } finally {
      if (leadId) await supabase.from('prospecting_leads').delete().eq('id', leadId);
    }
  });
});
