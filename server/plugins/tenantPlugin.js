import { AsyncLocalStorage } from 'async_hooks';

export const tenantContext = new AsyncLocalStorage();
export const runWithTenant = (orgId, fn) => tenantContext.run({ orgId }, fn);
export const getCurrentOrgId = () => tenantContext.getStore()?.orgId ?? null;

const tenantPlugin = (schema) => {
    // NOTE: No index:true here — models define their own indexes explicitly
    // Having both causes the "Duplicate schema index" warning
    schema.add({
        organisationId: { type: 'ObjectId', ref: 'Organisation', required: false },
    });

    schema.pre('save', function (next) {
        if (this.isNew && !this.organisationId) {
            const orgId = getCurrentOrgId();
            if (orgId) this.organisationId = orgId;
        }
        next();
    });

    schema.pre('insertMany', function (next, docs) {
        const orgId = getCurrentOrgId();
        if (orgId) {
            docs.forEach((d) => { if (!d.organisationId) d.organisationId = orgId; });
        }
        next();
    });

    const HOOKS = [
        'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete',
        'findOneAndReplace', 'countDocuments', 'exists',
        'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
    ];

    HOOKS.forEach((hook) => {
        schema.pre(hook, function () {
            if (this.getOptions()._skipTenantFilter) return;
            const orgId = getCurrentOrgId();
            if (!orgId) return;
            if (!this.getFilter().organisationId) {
                this.where({ organisationId: orgId });
            }
        });
    });

    // B5 FIX: several controllers (dashboardController.js's aggregations, in
    // particular) already put `{ $match: { organisationId: orgId } }` as the
    // first stage of their own pipeline before calling .aggregate(). This
    // hook used to unconditionally unshift ANOTHER identical $match ahead of
    // it — harmless to MongoDB's query planner, but redundant and confusing
    // to read/debug. Now it only injects one if the pipeline doesn't already
    // start with a matching organisationId filter.
    schema.pre('aggregate', function () {
        if (this.options?._skipTenantFilter) return;
        const orgId = getCurrentOrgId();
        if (!orgId) return;

        const pipeline = this.pipeline();
        const firstStageMatch = pipeline[0]?.$match;
        const alreadyScoped =
            firstStageMatch &&
            Object.prototype.hasOwnProperty.call(firstStageMatch, 'organisationId') &&
            String(firstStageMatch.organisationId) === String(orgId);

        if (alreadyScoped) return;

        pipeline.unshift({ $match: { organisationId: orgId } });
    });

    schema.statics.withOrg = function (orgId) {
        return {
            find:           (f = {}) => this.find({ ...f, organisationId: orgId }),
            findOne:        (f = {}) => this.findOne({ ...f, organisationId: orgId }),
            countDocuments: (f = {}) => this.countDocuments({ ...f, organisationId: orgId }),
            create:         (doc)    => this.create({ ...doc, organisationId: orgId }),
        };
    };

    schema.query.skipTenantFilter = function () {
        return this.setOptions({ _skipTenantFilter: true });
    };
};

export default tenantPlugin;
