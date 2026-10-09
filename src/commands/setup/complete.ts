import { ApiError } from '../../lib/api'
import { completeOnboarding, getSetupStatus } from '../../lib/setup-api'
import type { SetupStatus } from '../../lib/setup-api'
import type { Session } from './login'
import { SetupError, done } from './output'

// Screen 6: complete onboarding, which starts the free trial, unless the
// organization already completed it. Then re-read status for the trial end.

/**
 * Complete onboarding when `status` shows it is not complete, and return a fresh status.
 *
 * @throws SetupError when the runtime has no doc collection for the organization yet.
 */
export async function completeSetup(session: Session, status: SetupStatus): Promise<SetupStatus> {
  if (!status.onboarding_completed) {
    try {
      await completeOnboarding(session.client, session.orgId)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'doc_collection_required') {
        throw new SetupError(
          'doc_collection_required',
          'Promptless has not recorded the docs repository yet. Run `promptless setup` again in a minute.',
        )
      }
      throw err
    }
    done('Setup complete')
  }
  return getSetupStatus(session.client, session.orgId)
}
