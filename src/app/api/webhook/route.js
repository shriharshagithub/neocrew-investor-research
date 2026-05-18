import { NextResponse } from 'next/server';

const INVESTOR_PIPELINE_LIST_ID = '901614937724';

export async function POST(request) {
  try {
    const body = await request.json();

    // ClickUp webhook sends event + task_id only
    const event = body.event;
    const taskId = body.task_id;

    // Only handle task creation events
    if (event !== 'taskCreated') {
      return NextResponse.json({ message: 'Not a task creation event' }, { status: 200 });
    }

    if (!taskId) {
      return NextResponse.json({ error: 'Missing task_id' }, { status: 400 });
    }

    // Fetch full task details from ClickUp
    const taskResponse = await fetch(
      `https://api.clickup.com/api/v2/task/${taskId}`,
      {
        headers: {
          'Authorization': process.env.CLICKUP_API_TOKEN,
          'Content-Type': 'application/json',
        }
      }
    );

    if (!taskResponse.ok) {
      throw new Error('Failed to fetch task details from ClickUp');
    }

    const task = await taskResponse.json();
    const taskName = task?.name || '';
    const taskDescription = task?.description || '';
    const listId = task?.list?.id;

    // Only process Investor Pipeline tasks
    if (listId !== INVESTOR_PIPELINE_LIST_ID) {
      return NextResponse.json({ message: 'Not investor pipeline' }, { status: 200 });
    }

    if (!taskName) {
      return NextResponse.json({ error: 'Missing task name' }, { status: 400 });
    }

    // DEDUPLICATION — skip if research comment already exists
    const commentsResponse = await fetch(
      `https://api.clickup.com/api/v2/task/${taskId}/comment`,
      { headers: { 'Authorization': process.env.CLICKUP_API_TOKEN } }
    );
    if (commentsResponse.ok) {
      const commentsData = await commentsResponse.json();
      const alreadyDone = commentsData.comments?.some(c =>
        c.comment_text?.includes('INVESTOR RESEARCH READY')
      );
      if (alreadyDone) {
        console.log(`Already researched ${taskId} — skipping duplicate`);
        return NextResponse.json({ message: 'Already researched' }, { status: 200 });
      }
    }

    // Extract LinkedIn URL from description if provided
    const linkedInMatch = taskDescription.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\s\n]+/);
    const linkedInUrl = linkedInMatch ? linkedInMatch[0] : null;

    const parts = taskName.split('|');
    const investorName = parts[0]?.trim() || taskName;
    const fund = parts[1]?.trim() || 'fund not specified';

    const linkedInContext = linkedInUrl
      ? `LinkedIn profile: ${linkedInUrl} — use this to confirm identity and get accurate details.`
      : `No LinkedIn provided — search carefully using "${investorName} ${fund}" to find the right person.`;

    console.log(`Researching: ${investorName} from ${fund}`);

    // Call Claude API with web search to research investor
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Research ${investorName} from ${fund} for NeoCrew AI's investor outreach.

${linkedInContext}

Research and find:
1. Their investment thesis and focus areas
2. Typical cheque size — if below $1M, flag as "BELOW MINIMUM — skip this investor"
3. Recent portfolio companies (last 2 years)
4. Any AI, developer tools, or product development investments
5. Any India or B2B SaaS connections
6. One specific recent post, investment, or statement to personalise the outreach

Then write a highly personalised outreach message from Amit Singh, co-founder of NeoCrew AI.

About NeoCrew AI:
- AI-powered product development platform — "brief in, working product out"
- Ships complete products using 5 AI agents (BA, Designer, Architect, Frontend Dev, Backend Dev)
- $150K+ booked in month 1, pre-launch
- Raising $1M pre-seed SAFE note at $25M cap
- $300K total pipeline + won deals
- Built by team behind Wow Labz — enterprise track record with AB InBev, HDFC, Emaar
- Amit is from Headstart (well-known Indian startup community)
- Thesis: SaaS is being repriced, custom software wins, NeoCrew is the platform for that

The outreach message must:
- Be 3 short paragraphs max
- Reference something specific about this investor or their fund
- Connect NeoCrew's thesis to their investment focus
- Mention the $150K month 1 traction
- End with a clear ask: 30-minute call
- Sound personal, not templated
- Be from Amit, signed off as "Amit"

Format your response EXACTLY like this:

RESEARCH — ${investorName} | ${fund}
─────────────────────────
Thesis: [1 line]
Stage: [pre-seed / seed / series A]
Cheque: [range — flag BELOW MINIMUM if under $1M]
Recent bets: [2-3 companies]
Thesis fit: [1 line — why NeoCrew fits]
Reference: [1 specific thing to mention in outreach]

OUTREACH MESSAGE
─────────────────────────
[3 paragraphs max. Personal. From Amit. Sign off as "Amit".]

TALKING POINTS (if they reply)
─────────────────────────
1. [Point]
2. [Point]
3. [Point]`
        }]
      })
    });

    const claudeData = await claudeResponse.json();

    if (!claudeResponse.ok) {
      console.error('Claude API error:', claudeData);
      throw new Error(`Claude API failed: ${claudeData.error?.message || 'Unknown error'}`);
    }

    // Extract text from Claude's response
    const responseText = claudeData.content
      ?.filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || 'Research completed but no content returned.';

    // Post the research + message as a comment on the ClickUp task
    const commentBody = `INVESTOR RESEARCH READY — ${investorName}
─────────────────────────

${responseText}

─────────────────────────
Generated automatically by NeoCrew Research Agent`;

    const commentResponse = await fetch(
      `https://api.clickup.com/api/v2/task/${taskId}/comment`,
      {
        method: 'POST',
        headers: {
          'Authorization': process.env.CLICKUP_API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment_text: commentBody,
          notify_all: true,
        })
      }
    );

    if (!commentResponse.ok) {
      const err = await commentResponse.text();
      console.error('ClickUp comment failed:', err);
      throw new Error('Failed to post comment to ClickUp');
    }

    console.log(`Research posted for ${investorName}`);
    return NextResponse.json({ success: true, investor: investorName });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({ 
    status: 'NeoCrew Investor Research Agent is running',
    version: '1.0.0'
  });
}
