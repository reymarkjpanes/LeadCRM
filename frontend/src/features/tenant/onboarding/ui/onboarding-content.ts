import { Compass, Users, Building2, ListChecks, Mail, Workflow, Package, Search } from 'lucide-react';

export const onboardingTopics = [
  {
    icon: Compass, title: 'Welcome to LeadCRM', theme: 'One workspace for your team',
    description: 'Build customer relationships and keep your next steps in view.',
    intro: 'LeadCRM brings Camxian Technologies’ customer relationships and sales activities together.',
    features: [
      ['Find your way', 'Use the sidebar to move between CRM records, workspace tools, and Settings.'],
      ['Start with your work', 'Check the Dashboard, then open your assigned records and follow-ups.'],
      ['Work with your team', 'Your assigned role determines which records and actions you can access.'],
    ], note: 'This short tour introduces the workspace. You can skip it whenever you are ready.',
  },
  {
    icon: Users, title: 'Leads & Contacts', theme: 'Know who you are talking to',
    description: 'Keep prospects, customer contacts, and conversations connected.',
    intro: 'Leads capture prospects. Contacts keep established customer relationships organized.',
    features: [
      ['Track the relationship', 'Review status, contact details, and the assigned agent before following up.'],
      ['Follow engagement', 'Customer email replies can update Lead and Contact engagement status.'],
      ['Convert when appropriate', 'Use the Lead conversion action to create or link the related customer records.'],
    ], note: 'Engagement describes customer interaction. It does not directly move a Deal to another stage.',
  },
  {
    icon: Building2, title: 'Accounts & Deals', theme: 'Turn relationships into opportunities',
    description: 'Connect organizations, products, and the progress of each sale.',
    intro: 'Accounts represent organizations or customers. Deals track individual sales opportunities.',
    features: [
      ['Connect the context', 'Link Deals to customer records and record Product Interest.'],
      ['Keep the pipeline current', 'Review pipeline stage, Deal value, and expected close date.'],
      ['Close with complete details', 'Resolve the required Deal information and any validation shown before marking Closed Won.'],
    ], note: 'Deal stages change through permitted user actions or configured Workflows.',
  },
  {
    icon: ListChecks, title: 'Tasks & Activities', theme: 'Make every follow-up count',
    description: 'See what needs doing and the history behind it.',
    intro: 'Tasks organize upcoming work. Activities show the history of actions on CRM records.',
    features: [
      ['Plan the next action', 'Create a Task with an assignee, due date, and related CRM record.'],
      ['Keep work visible', 'Update Task status as work progresses and review upcoming deadlines.'],
      ['Read the history', 'Use record Activities to understand prior changes and interactions.'],
    ], note: 'Access to Tasks and related records follows your assigned permissions.',
  },
  {
    icon: Mail, title: 'Campaigns & Email', theme: 'Keep conversations moving',
    description: 'Coordinate outreach and follow customer responses.',
    intro: 'Campaigns organize recipient communication. Gmail / Inbox connects your authorized mailbox.',
    features: [
      ['Prepare outreach', 'Review Campaign recipients and content before sending.'],
      ['Connect Gmail securely', 'Use the Google authorization flow to grant the required mailbox permissions.'],
      ['Follow the response', 'Review available email tracking and customer replies alongside engagement status.'],
    ], note: 'Signing in to LeadCRM does not connect Gmail. Google authorization is a separate step.',
  },
  {
    icon: Workflow, title: 'Workflows', theme: 'Give repeatable work a clear process',
    description: 'Define when an automation runs and what it should do.',
    intro: 'Workflows combine a Trigger, Conditions, and Actions to automate supported CRM processes.',
    features: [
      ['Choose a Trigger', 'Select the supported event that starts the Workflow.'],
      ['Check Conditions', 'Narrow the records or circumstances that should qualify.'],
      ['Configure Actions', 'Set the actions to run, including Deal-stage changes when needed.'],
    ], note: 'Email engagement alone does not change Deal stages. Configure that automation in Workflows.',
  },
  {
    icon: Package, title: 'Forms & Products', theme: 'Capture interest with context',
    description: 'Bring incoming information and your offerings into the workspace.',
    intro: 'Forms collect submissions. Products define the offerings your team uses in CRM records.',
    features: [
      ['Manage Forms', 'Configure available Form fields and review submissions.'],
      ['Maintain Products', 'Keep Product names and configuration up to date in Settings.'],
      ['Record Product Interest', 'Connect customer interest to the appropriate offerings.'],
    ], note: 'Form and Product management tools are available according to your role.',
  },
  {
    icon: Search, title: 'Notifications & Search', theme: 'Find what needs your attention',
    description: 'Return to the right records and keep up with changes.',
    intro: 'Notifications highlight workspace updates. Global search helps you find accessible CRM records.',
    features: [
      ['Check Notifications', 'Open the notification bell to review updates and follow links to related records.'],
      ['Search across records', 'Use the header search and module filter to find the information you need.'],
      ['Keep details current', 'Review the record, update its status where appropriate, and plan the next step.'],
    ], note: 'You are ready to start. Finish saves this tour as complete for your account.',
  },
] as const;
