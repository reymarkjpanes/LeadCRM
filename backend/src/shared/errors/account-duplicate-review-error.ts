import { ACCOUNT_DUPLICATE_REVIEW_CODE, ACCOUNT_DUPLICATE_REVIEW_MESSAGE, type AccountDuplicateReview } from '@leadcrm/shared';
import { AppError } from './app-error';

export class AccountDuplicateReviewError extends AppError {
  constructor(public readonly review: AccountDuplicateReview) {
    super(ACCOUNT_DUPLICATE_REVIEW_MESSAGE, 409, ACCOUNT_DUPLICATE_REVIEW_CODE);
  }
}
