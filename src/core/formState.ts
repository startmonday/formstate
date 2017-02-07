import { observable, action, computed, runInAction, isObservable, isArrayLike } from 'mobx';
import { Validatable, Validator, applyValidators } from './types';

/** Each key of the object is a validatable */
export type ValidatableMapOrArray =
  { [key: string]: Validatable<any> }
  | Validatable<any>[]

/**
 * Just a wrapper around the helpers for a set of FieldStates or FormStates
 */
export class FormState<TValue extends ValidatableMapOrArray> implements Validatable<TValue> {
  private mode: 'array' | 'map' = 'map';
  constructor(
    /**
     * SubItems can be any Validatable
     */
    public $: TValue
  ) {
    this.mode = isArrayLike($) ? 'array' : 'map';

    /** If they didn't send in something observable make the local $ observable */
    if (!isObservable(this.$)) {
      this.$ = observable(this.$);
    }
  }

  /** Get validatable objects from $ */
  private getValues = (): Validatable<any>[] => {
    if (this.mode === 'array') return (this.$ as any);
    const keys = Object.keys(this.$);
    return keys.map((key) => this.$[key]);
  }

  @observable validating = false;

  @action enableAutoValidation = () => {
    this.getValues().forEach(x => x.enableAutoValidation());
  }

  private _validators: Validator<TValue>[] = [];
  @action validators = (...validators: Validator<TValue>[]) => {
    this._validators = validators;
    return this;
  }

  /**
   * - Re-runs validation on all fields
   * - returns `hasError`
   * - if no error also return the validated values against each key.
   */
  @action async validate(): Promise<{ hasError: true } | { hasError: false, value: TValue }> {
    this.validating = true;
    const values = this.getValues();
    let fieldsResult = await Promise.all(values.map((value) => value.validate()));
    const done = runInAction(() => {
      if (fieldsResult.some(f => f.hasError)) {
        this.validating = false;
        return true;
      }
      return false
    });
    if (done) return { hasError: true as true };

    /** Otherwise do any local validations */
    const error = await applyValidators(this.$, this._validators || []);
    const res = runInAction(() => {
      if (error != this._error) {
        this._error = error;
      }
      this.validating = false;

      const hasError = !!error;
      if (hasError) {
        return { hasError: true as true };
      }
      return { hasError: false as false, value: this.$ };
    });

    return res;
  }

  @observable private _error: string | null | undefined = '';

  /**
   * Does any field or form have an error
   */
  @computed get hasError() {
    return this.hasFieldError || this.hasFormError;
  }

  /**
   * Does any field have an error
   */
  @computed get hasFieldError() {
    return this.getValues().some(f => f.hasError);
  }

  /**
   * Does form level validation have an error
   */
  @computed get hasFormError() {
    return !!this._error;
  }

  /**
   * Call it when you are `reinit`ing child fields
   */
  @action clearFormError() {
    this._error = '';
  }

  /**
   * Error from some sub field if any
   */
  @computed get fieldError() {
    const subItemWithError = this.getValues().find(f => !!f.hasError);
    return subItemWithError ? subItemWithError.error : null;
  }

  /**
   * Error from form if any
   */
  @computed get formError() {
    return this._error;
  }

  /**
   * The first error from any sub (if any) or form error
   */
  @computed get error() {
    return this.fieldError || this.formError;
  }
}
